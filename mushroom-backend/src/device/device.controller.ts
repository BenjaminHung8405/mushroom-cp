import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Res,
  Sse,
  MessageEvent,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, merge, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { MqttService } from '../mqtt/mqtt.service';

/**
 * DeviceController — HTTP interface for device management and real-time status.
 *
 * Endpoints:
 *   GET  /devices/status/stream  - SSE stream (real-time device status for Next.js UI)
 *   GET  /devices/:id/status     - REST: current status of a specific device
 *   POST /devices/:id/setpoint   - REST: publish a setpoint command to a device via MQTT
 *
 * SSE Architecture:
 *   Next.js UI connects once → NestJS holds the connection open → EMQX fires LWT →
 *   MqttService emits event → SSE controller pushes MessageEvent → Browser receives update →
 *   UI turns Crimson (Danger) status indicator.
 *
 * CORS: Handled by NestJS global config; SSE requires
 *   'Cache-Control: no-cache', 'Connection: keep-alive', 'Content-Type: text/event-stream'
 *   headers which NestJS @Sse() sets automatically.
 */
@Controller('devices')
export class DeviceController {
  private readonly logger = new Logger(DeviceController.name);

  constructor(private readonly mqttService: MqttService) {}

  /**
   * SSE endpoint: streams real-time device status events to the Next.js UI.
   *
   * On connection:
   *   1. Immediately sends the current cached status for ALL known devices
   *      so the UI shows accurate state right away (no stale "unknown" state).
   *   2. Then streams live events as devices come online/offline.
   *
   * Usage (Next.js):
   *   const evtSource = new EventSource('http://localhost:3001/devices/status/stream');
   *   evtSource.addEventListener('device-status', (e) => { ... });
   *
   * @returns Observable<MessageEvent>
   */
  @Sse('status/stream')
  streamDeviceStatus(): Observable<MessageEvent> {
    this.logger.log('SSE client connected → /devices/status/stream');

    // Seed: emit all currently known device statuses immediately
    const seedEvents$ = of(...this.mqttService.getAllDeviceStatuses());

    // Live: emit as new status events arrive (LWT + online broadcasts)
    const liveEvents$ = this.mqttService.deviceStatus$;

    return merge(seedEvents$, liveEvents$).pipe(
      map((event) => ({
        type: 'device-status',
        data: event,
      }) satisfies MessageEvent),
    );
  }

  /**
   * REST: Get current cached status of a specific device.
   *
   * @param id - Device ID (same as MQTT username, e.g. esp32_mushroom_s3_01)
   */
  @Get(':id/status')
  getDeviceStatus(@Param('id') id: string) {
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
   *
   * The NestJS backend is the "gatekeeper" — it validates the command
   * before publishing it to the MQTT broker. This prevents rogue UI
   * clients from sending arbitrary commands.
   *
   * @param id - Target device ID
   * @param body - Setpoint payload (e.g. { humidity: 85, temperature: 30 })
   */
  @Post(':id/setpoint')
  @HttpCode(202)
  publishSetpoint(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.logger.log(`Publishing setpoint to device '${id}': ${JSON.stringify(body)}`);
    this.mqttService.publish(id, body);
    return {
      message: `Setpoint command dispatched to device '${id}'.`,
      payload: body,
    };
  }
}
