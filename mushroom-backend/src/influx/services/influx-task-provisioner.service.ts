import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from './config.service';

const TASK_NAME = 'kpi_hourly_aggregation';
const SOURCE_BUCKET_PLACEHOLDER = '__INFLUXDB_BUCKET__';
const ANALYTICS_BUCKET_PLACEHOLDER = '__INFLUXDB_ANALYTICS_BUCKET__';

interface InfluxTask {
  id: string;
  name: string;
  status?: 'active' | 'inactive';
}

interface InfluxTasksResponse {
  tasks?: InfluxTask[];
}

interface InfluxOrganization {
  id: string;
  name: string;
}

interface InfluxOrganizationsResponse {
  orgs?: InfluxOrganization[];
}

@Injectable()
export class InfluxTaskProvisionerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InfluxTaskProvisionerService.name);

  constructor(private readonly configService: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.readConfig();
    const fluxTemplate = await readFile(
      join(__dirname, '../tasks/kpi-hourly.flux'),
      'utf8',
    );
    const flux = compileKpiTaskFlux(
      fluxTemplate,
      config.sourceBucket,
      config.analyticsBucket,
    );
    const headers = {
      Authorization: `Token ${config.token}`,
      'Content-Type': 'application/json',
    };

    const organizations = await this.request<InfluxOrganizationsResponse>(
      `${config.url}/api/v2/orgs?org=${encodeURIComponent(config.org)}`,
      { headers },
    );
    const org = organizations.orgs?.[0];
    if (!org?.id) {
      throw new Error(`InfluxDB organization '${config.org}' was not found`);
    }

    const existing = await this.request<InfluxTasksResponse | InfluxTask[]>(
      `${config.url}/api/v2/tasks?name=${encodeURIComponent(TASK_NAME)}`,
      { headers },
    );
    const task = Array.isArray(existing) ? existing[0] : existing.tasks?.[0];
    if (task?.status === 'active') return;

    if (task) {
      await this.request<unknown>(`${config.url}/api/v2/tasks/${task.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'active', flux }),
      });
      this.logger.log(`Enabled InfluxDB task ${TASK_NAME}`);
      return;
    }

    await this.request<unknown>(`${config.url}/api/v2/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        orgID: org.id,
        name: TASK_NAME,
        status: 'active',
        flux,
      }),
    });
    this.logger.log(`Created InfluxDB task ${TASK_NAME}`);
  }

  private readConfig(): {
    url: string;
    token: string;
    org: string;
    sourceBucket: string;
    analyticsBucket: string;
  } {
    const getRequired = (key: string): string => {
      const value = this.configService.get(key)?.trim();
      if (!value || value.length > 255 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error(`${key} must be a non-empty value of at most 255 characters`);
      }
      return value;
    };
    const url = getRequired('INFLUXDB_URL').replace(/\/+$/u, '');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error('INFLUXDB_URL must be a valid HTTP(S) URL');
    }
    return {
      url,
      token: getRequired('INFLUXDB_TOKEN'),
      org: getRequired('INFLUXDB_ORG'),
      sourceBucket: getRequired('INFLUXDB_BUCKET'),
      analyticsBucket: getRequired('INFLUXDB_ANALYTICS_BUCKET'),
    };
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`InfluxDB Tasks API request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}

export function compileKpiTaskFlux(
  template: string,
  sourceBucket: string,
  analyticsBucket: string,
): string {
  if (!template.includes(SOURCE_BUCKET_PLACEHOLDER) ||
      !template.includes(ANALYTICS_BUCKET_PLACEHOLDER)) {
    throw new Error('KPI Flux template is missing bucket placeholders');
  }
  return template
    .replaceAll(
      SOURCE_BUCKET_PLACEHOLDER,
      escapeFluxString(sourceBucket),
    )
    .replaceAll(
      ANALYTICS_BUCKET_PLACEHOLDER,
      escapeFluxString(analyticsBucket),
    );
}

function escapeFluxString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
