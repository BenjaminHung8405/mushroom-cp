import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable global validation pipe for whitelisting and validation of body payloads
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Enable CORS so Next.js UI (running on a different port/origin) can
  // connect to the SSE endpoint and REST APIs.
  app.enableCors({
    origin: true, // In production, restrict to your specific UI domain
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
