import { Injectable, Logger } from '@nestjs/common';
import { InfluxDB, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { ConfigService } from './config.service';

@Injectable()
export class InfluxDbService {
  private readonly logger = new Logger(InfluxDbService.name);
  private readonly influx: InfluxDB | null = null;
  private readonly org: string;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get('INFLUXDB_URL') ?? '';
    const token = this.configService.get('INFLUXDB_TOKEN') ?? '';
    this.org = this.configService.get('INFLUXDB_ORG') ?? '';

    if (!url || !token || !this.org) {
      this.logger.error('InfluxDB is not configured properly in ConfigService');
      this.influx = null;
      return;
    }

    this.influx = new InfluxDB({ url, token });
  }

  getWriteApi(bucket: string, precision: 'ms' | 's' | 'us' | 'ns' = 'ms'): WriteApi | null {
    if (!this.influx) {
      return null;
    }
    return this.influx.getWriteApi(this.org, bucket, precision);
  }

  getQueryApi(): QueryApi | null {
    if (!this.influx) {
      return null;
    }
    return this.influx.getQueryApi(this.org);
  }
}
