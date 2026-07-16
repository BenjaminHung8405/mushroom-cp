import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { Device } from '../device/entities/device.entity';

export interface MqttAuthRequest {
  username?: string;
  password?: string;
  clientid?: string;
}

export interface MqttAclRequest {
  username?: string;
  clientid?: string;
  topic?: string;
  acc?: string | number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class MqttAuthService {
  private readonly logger = new Logger(MqttAuthService.name);
  private readonly tenant = process.env.IOT_TENANT ?? 'mushroom';
  private readonly rateWindows = new Map<string, RateWindow>();

  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  async authenticate(request: MqttAuthRequest): Promise<boolean> {
    const username = request.username ?? '';
    const password = request.password ?? '';
    const clientId = request.clientid ?? '';
    const bootstrapUser = process.env.MQTT_BOOTSTRAP_USER ?? 'provision_node';
    const backendUser = process.env.MQTT_BACKEND_USER ?? '';

    // The backend consumes every tenant topic and publishes provisioning replies.
    // It uses a fixed client ID, so it must not be subject to device ID matching.
    if (username === backendUser) {
      return this.sameSecret(password, process.env.MQTT_BACKEND_PASS);
    }

    if (username === bootstrapUser) {
      this.enforceRateLimit(`auth:${clientId || 'unknown'}`, 10);
      return this.sameSecret(password, process.env.MQTT_BOOTSTRAP_SECRET);
    }

    if (!username || username !== clientId || !password) return false;
    const device = await this.deviceRepo.findOne({ where: { deviceId: username } });
    return Boolean(device?.enabled && this.sameSecret(password, device.token));
  }

  isSuperuser(username?: string): boolean {
    return Boolean(username && username === process.env.MQTT_BACKEND_USER);
  }

  authorize(request: MqttAclRequest): boolean {
    const username = request.username ?? '';
    const clientId = request.clientid ?? '';
    const topic = request.topic ?? '';
    const access = Number(request.acc);
    const bootstrapUser = process.env.MQTT_BOOTSTRAP_USER ?? 'provision_node';

    if (username === bootstrapUser) {
      if (!this.isMac(clientId)) return false;
      if (topic === `${this.tenant}/provision/request`) return access === 2;
      return topic === `${this.tenant}/provision/response/${clientId}` && access === 1;
    }

    return (
      username.length > 0 &&
      username === clientId &&
      topic.startsWith(`${this.tenant}/esp32/${username}/`) &&
      (access === 1 || access === 2 || access === 3 || access === 4)
    );
  }

  enforceProvisionRateLimit(macAddress: string): void {
    this.enforceRateLimit(`provision:${macAddress}`, 5);
  }

  private enforceRateLimit(key: string, maxRequests: number): void {
    const now = Date.now();
    const window = this.rateWindows.get(key);
    if (!window || now >= window.resetAt) {
      this.rateWindows.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    window.count += 1;
    if (window.count > maxRequests) {
      this.logger.warn(`Rate limit exceeded for ${key}.`);
      const err = new HttpException('MQTT authentication rate limit exceeded.', 429);
        throw err;
    }
  }

  private sameSecret(value: string, expected: string | null | undefined): boolean {
    if (!expected || !value) return false;
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private isMac(value: string): boolean {
    return /^[a-f0-9]{12}$/.test(value);
  }
}
