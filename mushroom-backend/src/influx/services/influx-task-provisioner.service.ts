import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
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

interface ProvisionerConfig {
  url: string;
  token: string;
  org: string;
  sourceBucket: string;
  analyticsBucket: string;
}

@Injectable()
export class InfluxTaskProvisionerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InfluxTaskProvisionerService.name);

  constructor(private readonly configService: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.readConfig();
    const headers = {
      Authorization: `Token ${config.token}`,
      'Content-Type': 'application/json',
    };
    const flux = await this.loadCompiledTaskFlux(
      config.sourceBucket,
      config.analyticsBucket,
    );
    const orgId = await this.resolveOrganizationId(config, headers);
    const task = await this.findTaskByName(config, headers);
    await this.activateOrCreateTask(config, headers, flux, orgId, task);
  }

  private async loadCompiledTaskFlux(
    sourceBucket: string,
    analyticsBucket: string,
  ): Promise<string> {
    const template = await readFile(
      join(__dirname, '../tasks/kpi-hourly.flux'),
      'utf8',
    );
    return compileKpiTaskFlux(template, sourceBucket, analyticsBucket);
  }

  private async resolveOrganizationId(
    config: ProvisionerConfig,
    headers: Record<string, string>,
  ): Promise<string> {
    const raw = await this.request<unknown>(
      `${config.url}/api/v2/orgs?org=${encodeURIComponent(config.org)}`,
      { headers },
    );
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Malformed InfluxDB Orgs API response');
    }
    const orgs = (raw as Record<string, unknown>).orgs;
    if (!Array.isArray(orgs)) {
      throw new Error(
        'Malformed InfluxDB Orgs API response: orgs must be an array',
      );
    }
    const org = orgs[0] as Record<string, unknown> | undefined;
    if (typeof org?.id !== 'string' || !org.id.trim()) {
      throw new Error(`InfluxDB organization '${config.org}' was not found`);
    }
    return org.id;
  }

  private async findTaskByName(
    config: ProvisionerConfig,
    headers: Record<string, string>,
  ): Promise<InfluxTask | undefined> {
    const raw = await this.request<unknown>(
      `${config.url}/api/v2/tasks?name=${encodeURIComponent(TASK_NAME)}`,
      { headers },
    );
    return parseAndValidateTaskResponse(raw);
  }

  private async activateOrCreateTask(
    config: ProvisionerConfig,
    headers: Record<string, string>,
    flux: string,
    orgId: string,
    task: InfluxTask | undefined,
  ): Promise<void> {
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
        orgID: orgId,
        name: TASK_NAME,
        status: 'active',
        flux,
      }),
    });
    this.logger.log(`Created InfluxDB task ${TASK_NAME}`);
  }

  private readConfig(): ProvisionerConfig {
    const getRequired = (key: string): string => {
      const value = this.configService.get(key)?.trim();
      if (!value || value.length > 255 || containsControlCharacter(value)) {
        throw new Error(
          `${key} must be a non-empty value of at most 255 characters`,
        );
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
  if (
    !template.includes(SOURCE_BUCKET_PLACEHOLDER) ||
    !template.includes(ANALYTICS_BUCKET_PLACEHOLDER)
  ) {
    throw new Error('KPI Flux template is missing bucket placeholders');
  }
  return template
    .replaceAll(SOURCE_BUCKET_PLACEHOLDER, escapeFluxString(sourceBucket))
    .replaceAll(
      ANALYTICS_BUCKET_PLACEHOLDER,
      escapeFluxString(analyticsBucket),
    );
}

function escapeFluxString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint >= 0 && codePoint <= 31) || codePoint === 127)
    ) {
      return true;
    }
  }
  return false;
}

function parseAndValidateTaskResponse(raw: unknown): InfluxTask | undefined {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      'Malformed InfluxDB Tasks API response: expected object or array',
    );
  }

  let tasksList: unknown[];
  if (Array.isArray(raw)) {
    tasksList = raw;
  } else if ('tasks' in raw) {
    const tasksProp = (raw as Record<string, unknown>).tasks;
    if (!Array.isArray(tasksProp)) {
      throw new Error(
        'Malformed InfluxDB Tasks API response: tasks property must be an array',
      );
    }
    tasksList = tasksProp;
  } else {
    throw new Error(
      'Malformed InfluxDB Tasks API response: missing tasks property',
    );
  }

  if (tasksList.length === 0) {
    return undefined;
  }

  for (const item of tasksList) {
    if (!isValidTaskObject(item)) {
      throw new Error(
        'Malformed InfluxDB task in response: missing or invalid id, name, or status',
      );
    }
  }

  const validTasks = tasksList as InfluxTask[];
  return validTasks.find((t) => t.name === TASK_NAME) ?? validTasks[0];
}

function isValidTaskObject(item: unknown): item is InfluxTask {
  if (typeof item !== 'object' || item === null) return false;
  const t = item as Record<string, unknown>;
  const hasValidId = typeof t.id === 'string' && t.id.trim().length > 0;
  const hasValidName = typeof t.name === 'string' && t.name.trim().length > 0;
  const hasValidStatus = t.status === 'active' || t.status === 'inactive';
  return hasValidId && hasValidName && hasValidStatus;
}
