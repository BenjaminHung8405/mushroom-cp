import { Injectable } from '@nestjs/common';

@Injectable()
export class AppConfigService {
  private readonly tenant: string;

  constructor() {
    const tenant = process.env.IOT_TENANT?.trim();
    if (!tenant) {
      throw new Error('Configuration error: IOT_TENANT environment variable is required.');
    }
    if (!/^[a-z0-9_-]+$/.test(tenant)) {
      throw new Error(
        `Configuration error: IOT_TENANT "${tenant}" has invalid format. Only alphanumeric lowercase, hyphens, and underscores are allowed.`,
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
