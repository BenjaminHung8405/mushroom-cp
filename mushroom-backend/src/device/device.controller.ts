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
import { filter, map } from 'rxjs/operators';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  IsBoolean,
  IsIn,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { toZonedTime } from 'date-fns-tz';
import { Type } from 'class-transformer';
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

/** DTO for validating a global operating-mode command. */
export class OperatingModeDto {
  @IsIn(['AI', 'MANUAL'])
  mode: 'AI' | 'MANUAL';
}

export class CropProfileCheckpointDto {
  @IsInt()
  @Min(1)
  cropDay: number;

  @IsNumber()
  @Min(15)
  @Max(45)
  temperatureCelsius: number;

  @IsNumber()
  @Min(50)
  @Max(100)
  humidityPercent: number;
}

export class CropProfileLightScheduleBlockDto {
  @IsInt()
  @Min(1)
  startDay: number;

  @IsInt()
  @Min(1)
  endDay: number;

  @IsIn(['ON', 'OFF'])
  status: 'ON' | 'OFF';
}

export class ApplyCropProfileDto {
  @IsNumber()
  cropStartEpochSec: number;

  @IsInt()
  @Min(1)
  @Max(365)
  totalCropDays: number;

  @ValidateNested({ each: true })
  @Type(() => CropProfileCheckpointDto)
  checkpoints: CropProfileCheckpointDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CropProfileLightScheduleBlockDto)
  lightSchedule?: CropProfileLightScheduleBlockDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  configRevision?: number;
}

/**
 * DeviceController — HTTP interface for device management and real-time status.
 */
@Controller('devices')
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

  @Sse(':id/config-sync/stream')
  streamConfigSync(@Param() params: DeviceParamsDto): Observable<MessageEvent> {
    const cached = this.mqttService.getConfigSync(params.id);
    const updates$ = this.mqttService.configSync$.pipe(
      filter((event) => event.deviceId === params.id),
      map((event) => ({ data: event }) satisfies MessageEvent),
    );
    return cached
      ? merge(of({ data: cached } as MessageEvent), updates$)
      : updates$;
  }

  @Get(':id/config-sync')
  getConfigSync(@Param() params: DeviceParamsDto) {
    return (
      this.mqttService.getConfigSync(params.id) ?? {
        deviceId: params.id,
        status: 'OUT_OF_SYNC',
        desiredRevision: null,
        appliedRevision: null,
        commandId: null,
        kind: null,
        error: null,
        updatedAt: null,
      }
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

    const sync = await this.mqttService.dispatchSetpoint(id, {
      temperatureSetpoint,
      humiditySetpoint,
      setpoint_ttl_sec: 0,
    });
    return { message: `Đang đồng bộ setpoint xuống thiết bị '${id}'.`, sync };
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
    const device =
      this.deviceRegistryService.get(id) ??
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

  @Post(':id/apply-crop-profile')
  @HttpCode(202)
  async applyCropProfile(
    @Param() params: DeviceParamsDto,
    @Body() body: ApplyCropProfileDto,
  ) {
    const device =
      this.deviceRegistryService.get(params.id) ??
      (await this.deviceRegistryService.refreshOne(params.id));
    if (!device)
      throw new NotFoundException(`Device '${params.id}' not found.`);

    // Guard: only allow crop profile change when an active batch exists on this house
    try {
      const activeBatch = await this.batchService.getActiveBatchByHouseId(
        device.houseId,
      );
      if (!activeBatch) {
        throw new BadRequestException(
          'Chua co vụ nuoi dang hoạt dong — khong the ap dung crop profile.',
        );
      }
      // Validate checkpoints against active batch total days
      if (
        body.totalCropDays !== activeBatch.totalCropDays &&
        body.totalCropDays > activeBatch.totalCropDays
      ) {
        throw new BadRequestException(
          `totalCropDays(${body.totalCropDays}) nam ngoai khoang cho phep cua vụ (${activeBatch.totalCropDays} ngay).`,
        );
      }
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      )
        throw err;
      this.logger.warn(
        `Batch validation failed for ${params.id}: ${err?.message ?? 'unknown'}`,
      );
    }

    const sync = await this.mqttService.dispatchCropProfile(params.id, body);
    return { message: 'Đang đồng bộ crop profile xuống thiết bị.', sync };
  }

  @Post(':id/actuator-override')
  @HttpCode(202)
  async publishActuatorOverride(
    @Param() params: DeviceParamsDto,
    @Body() body: ActuatorOverrideDto,
  ) {
    const { id } = params;
    const { actuator, state } = body;

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

      if (
        minutesSinceMidnight >= startBlackout &&
        minutesSinceMidnight <= endBlackout
      ) {
        throw new BadRequestException(
          `Không thể bật máy tạo ẩm thủ công trong khung giờ bảo vệ sốc nhiệt (11:00 - 13:30).`,
        );
      }
    }

    if (
      (actuator === 'heater_air' ||
        actuator === 'lamp' ||
        actuator === 'lamp_stage') &&
      state === true
    ) {
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
