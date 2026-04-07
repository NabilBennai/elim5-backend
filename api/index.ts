import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';

const server = express();
let appReady: Promise<typeof server> | undefined;

function getAllowedOrigins() {
  return process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? true;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    rawBody: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: getAllowedOrigins(),
  });

  await app.init();
  return server;
}

export default async (req: any, res: any) => {
  appReady ??= bootstrap();
  const app = await appReady;
  app(req, res);
};
