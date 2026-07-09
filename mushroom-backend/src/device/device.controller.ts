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
} from 'class-validator';
import { MqttService } from '../mqtt/mqtt.service';

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
 * DeviceController — HTTP interface for device management and real-time status.
 */
@Controller('devices')
export class DeviceController {
  private readonly logger = new Logger(DeviceController.name);

  constructor(private readonly mqttService: MqttService) {}

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
   * REST: Publish a setpoint command to a device via MQTT.
   */
  @Post(':id/setpoint')
  @HttpCode(202)
  publishSetpoint(
    @Param() params: DeviceParamsDto,
    @Body() body: DeviceSetpointDto,
  ) {
    const { id } = params;
    this.logger.log(
      `Publishing setpoint to device '${id}': ${JSON.stringify(body)}`,
    );
    // Convert to Record<string, unknown> to match MqttService signature
    const payload = body as unknown as Record<string, unknown>;
    this.mqttService.publish(id, payload);
    return {
      message: `Setpoint command dispatched to device '${id}'.`,
      payload: body,
    };
  }
}
