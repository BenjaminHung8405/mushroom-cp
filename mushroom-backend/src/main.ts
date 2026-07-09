import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS so Next.js UI (running on a different port/origin) can
  // connect to the SSE endpoint and REST APIs.
  app.enableCors({
    origin: true,   // In production, restrict to your specific UI domain
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
