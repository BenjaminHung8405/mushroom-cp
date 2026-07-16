import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Sse,
  MessageEvent,
  Logger,
  HttpCode,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, merge, of } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { toZonedTime } from 'date-fns-tz';
import { MqttService } from '../mqtt/mqtt.service';
import { DeviceRegistryService } from './device-registry.service';
import { BatchService } from '../batch/services/batch.service';

/**
 * DTO for validating the device ID route parameter.
 * Restricts the ID to alphanumeric characters, underscores, and hyphens
 * to prevent special character injections or path traversal.
 */
export class DeviceParamsDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  id: string;
}

/**
 * DTO for validating the setpoint control commands sent to devices.
 * Ensures numbers fall within safe biological and physical bounds.
 */
export class DeviceSetpointDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidityMeasured?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  temperatureMeasured?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  co2Measured?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humiditySetpoint?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  temperatureSetpoint?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  temperature?: number;
}

/**
 * DTO for validating actuator manual overrides.
 */
export class ActuatorOverrideDto {
  @IsString()
  @IsIn(['fan', 'heater_air', 'mist', 'lamp', 'lamp_stage'])
  actuator: 'fan' | 'heater_air' | 'mist' | 'lamp' | 'lamp_stage';

  @IsOptional()
  @IsBoolean()
  state: boolean | null;
}

/**
 * DeviceController — HTTP interface for device management and real-time status.
 */
@Controller('devices')
export class OperatingModeDto {
  @IsIn(['AI', 'MANUAL'])
  mode: 'AI' | 'MANUAL';
}

export class DeviceController {
  private readonly logger = new Logger(DeviceController.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly deviceRegistryService: DeviceRegistryService,
    private readonly batchService: BatchService,
  ) {}

  /**
   * SSE endpoint: streams real-time device status events to the Next.js UI.
   */
  @Sse('status/stream')
  streamDeviceStatus(): Observable<MessageEvent> {
    this.logger.log('SSE client connected → /devices/status/stream');

    const seedEvents$ = of(...this.mqttService.getAllDeviceStatuses());
    const liveEvents$ = this.mqttService.deviceStatus$;

    return merge(seedEvents$, liveEvents$).pipe(
      map(
        (event) =>
          ({
            type: 'device-status',
            data: event,
          }) satisfies MessageEvent,
      ),
    );
  }

  /**
   * REST: List registered devices. Deliberately exposes only browser-safe
   * fields; MQTT credentials, tokens, and internal timestamps stay private.
   */
  @Get()
  listDevices() {
    return this.deviceRegistryService.listCached().map((device) => ({
      deviceId: device.deviceId,
      displayName: device.displayName,
      houseId: device.houseId,
      enabled: device.enabled,
      lastSeenAt: device.lastSeenAt,
    }));
  }

  /**
   * REST: Get the physical-house mapping for the monitored device.
   */
  @Get(':id')
  async getDevice(@Param() params: DeviceParamsDto) {
    const device =
      this.deviceRegistryService.get(params.id) ??
      (await this.deviceRegistryService.refreshOne(params.id));

    if (!device) {
      throw new NotFoundException(`Device '${params.id}' not found.`);
    }

    return {
      deviceId: device.deviceId,
      houseId: device.houseId,
      displayName: device.displayName,
    };
  }

  /**
   * REST: Get current cached status of a specific device.
   */
  @Get(':id/status')
  getDeviceStatus(@Param() params: DeviceParamsDto) {
    const { id } = params;
    const allStatuses = this.mqttService.getAllDeviceStatuses();
    const deviceStatus = allStatuses.find((s) => s.deviceId === id);

    if (!deviceStatus) {
      return {
        deviceId: id,
        status: 'unknown',
        timestamp: new Date().toISOString(),
      };
    }

    return deviceStatus;
  }

  /**
   * REST: Publish advisory setpoints to a device via MQTT.
   * Edge firmware remains the safety authority for relays.
   * Manual production control is intentionally not exposed here.
   */
  @Post(':id/setpoint')
  @HttpCode(202)
  async publishSetpoint(
    @Param() params: DeviceParamsDto,
    @Body() body: DeviceSetpointDto,
  ) {
    const { id } = params;
    this.logger.log(
      `Publishing advisory setpoint to device '${id}': ${JSON.stringify(body)}`,
    );

    const temperatureSetpoint = body.temperatureSetpoint ?? body.temperature;
    const humiditySetpoint = body.humiditySetpoint ?? body.humidity;
    if (
      typeof temperatureSetpoint !== 'number' ||
      typeof humiditySetpoint !== 'number'
    ) {
      return {
        message: `Rejected: temperatureSetpoint and humiditySetpoint are required advisory fields.`,
        payload: body,
      };
    }

    await this.mqttService.dispatchSetpoint(id, {
      temperatureSetpoint,
      humiditySetpoint,
      control_mode: 'fuzzy_tpc',
      setpoint_ttl_sec: 120,
    });
    return {
      message: `Advisory setpoint dispatched to device '${id}'.`,
      payload: {
        temperatureSetpoint,
        humiditySetpoint,
        control_mode: 'fuzzy_tpc',
        setpoint_ttl_sec: 120,
      },
    };
  }

  /**
   * REST: Publish manual actuator overrides to a device via MQTT.
   * Subject to server-side bio-safety guardrail validation.
   */
  @Post(':id/operating-mode')
  @HttpCode(202)
  async publishOperatingMode(
    @Param() params: DeviceParamsDto,
    @Body() body: OperatingModeDto,
  ) {
    const { id } = params;
    const device = this.deviceRegistryService.get(id) ??
      (await this.deviceRegistryService.refreshOne(id));
    if (!device) {
      throw new NotFoundException(`Device '${id}' not found.`);
    }
    await this.mqttService.dispatchSetOperatingMode(id, body.mode);
    return {
      message: `Chế độ vận hành đã chuyển sang ${body.mode}.`,
      payload: { mode: body.mode },
    };
  }

  @Post(':id/actuator-override')
  @HttpCode(202)
  async publishActuatorOverride(
    @Param() params: DeviceParamsDto,
    @Body() body: ActuatorOverrideDto,
  ) {
    const { id } = params;
    let { actuator, state } = body;

    // 1. Check device registry
    const device =
      this.deviceRegistryService.get(id) ??
      (await this.deviceRegistryService.refreshOne(id));
    if (!device) {
      throw new NotFoundException(`Device '${id}' not found.`);
    }

    // 2. Validate biological guardrails (Server-side defense)
    if (actuator === 'mist' && state === true) {
      // Check Midday Blackout Window (11:00 AM - 1:30 PM local Vietnam time)
      const timezone = 'Asia/Ho_Chi_Minh';
      const localTime = toZonedTime(new Date(), timezone);
      const hour = localTime.getHours();
      const minute = localTime.getMinutes();
      
      const minutesSinceMidnight = hour * 60 + minute;
      const startBlackout = 11 * 60; // 11:00
      const endBlackout = 13 * 60 + 30; // 13:30
      
      if (minutesSinceMidnight >= startBlackout && minutesSinceMidnight <= endBlackout) {
        throw new BadRequestException(
          `Không thể bật máy tạo ẩm thủ công trong khung giờ bảo vệ sốc nhiệt (11:00 - 13:30).`,
        );
      }
    }

    if ((actuator === 'heater_air' || actuator === 'lamp' || actuator === 'lamp_stage') && state === true) {
      // Check if active batch has cropDay > 8
      try {
        const activeBatch = await this.batchService.getActiveBatchByHouseId(
          device.houseId,
        );
        if (activeBatch) {
          const telemetryTime = new Date();
          const elapsedMs =
            telemetryTime.getTime() - new Date(activeBatch.startDate).getTime();
          const cropDay = Math.floor(elapsedMs / 86400000) + 1;
          if (cropDay > 8) {
            throw new BadRequestException(
              `Thiết bị sưởi không được bật thủ công trong giai đoạn ra quả thể (ngày vụ nuôi: ${cropDay} > 8).`,
            );
          }
        }
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw err;
        }
        this.logger.warn(
          `Failed to check active batch for heater-air guard: ${err.message}`,
        );
      }
    }

    // 3. Dispatch to MQTT
    await this.mqttService.dispatchActuatorOverride(id, actuator, state);

    return {
      message: `Lệnh ghi đè thiết bị '${actuator}' đã được gửi đi.`,
      payload: { actuator, state },
    };
  }
}
