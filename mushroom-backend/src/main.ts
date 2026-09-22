import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import type { Express } from 'express';

const productionSecretKeys = [
  'MQTT_BACKEND_PASS',
  'MQTT_BOOTSTRAP_SECRET',
  'POSTGRES_PASSWORD',
  'INFLUXDB_TOKEN',
  'INFLUXDB_INIT_PASSWORD',
] as const;

function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const unsafeKeys = productionSecretKeys.filter((key) => {
    const value = process.env[key]?.trim();
    return (
      !value || /change_me|changeme|default|example|replace_me/i.test(value)
    );
  });
  if (unsafeKeys.length > 0) {
    throw new Error(
      `Refusing production startup with missing or placeholder secrets: ${unsafeKeys.join(', ')}`,
    );
  }
}

function configureTrustedProxy(app: { set: (name: string, value: unknown) => void }): void {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 through 10.');
  }
  app.set('trust proxy', hops);
}


async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule);
  configureTrustedProxy(app.getHttpAdapter().getInstance());
  app.useGlobalFilters(new HttpExceptionFilter());
  configureTrustedProxy(app.getHttpAdapter().getInstance() as Express);

  // Enable global validation pipe for whitelisting and validation of body payloads
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Enable CORS so Next.js UI (running on a different port/origin) can
  // connect to the SSE endpoint and REST APIs.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];

  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
