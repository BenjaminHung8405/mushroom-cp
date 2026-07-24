import { Injectable } from '@nestjs/common';
import { validateSegment } from '../mqtt/constants/mqtt-topics.const';

@Injectable()
export class AppConfigService {
  private readonly tenant: string;

  constructor() {
    const tenant = process.env.IOT_TENANT?.trim();
    if (!tenant) {
      throw new Error(
        'Configuration error: IOT_TENANT environment variable is required.',
      );
    }
    try {
      validateSegment(tenant);
    } catch (err: any) {
      throw new Error(
        `Configuration error: IOT_TENANT is invalid. ${err.message}`,
      );
    }
    this.tenant = tenant;
  }

  getTenant(): string {
    return this.tenant;
  }

  get(key: string): string | undefined {
    return process.env[key];
  }
}
