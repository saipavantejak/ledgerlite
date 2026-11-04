import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: process.env.NODE_ENV === 'test' || process.env.VITEST ? false : ['log', 'warn', 'error'] });
  const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins && origins.length ? origins : true });
  app.enableShutdownHooks();
  return app;
}
