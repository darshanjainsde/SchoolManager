import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';
import { configureApp } from './src/configure-app';

const server = express();
let ready: Promise<void> | undefined;

async function init(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  configureApp(app);
  await app.init();
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  ready ??= init();
  await ready;
  (server as unknown as (a: unknown, b: unknown) => void)(req, res);
}
