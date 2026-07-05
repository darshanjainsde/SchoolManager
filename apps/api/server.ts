import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';
import { loadEnv } from '@skoolos/config';
import { configureApp } from './src/configure-app';

/**
 * Vercel serverless entrypoint. Vercel detects NestJS and treats this file's
 * exported handler as the app. The Nest app is bootstrapped once and cached
 * across warm invocations (Fluid Compute reuses the instance), so DI runs on
 * cold start only. Local dev keeps using `src/main.ts` (which binds a port).
 */
const expressApp = express();
let ready: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app, env);
  await app.init(); // NOT listen — Vercel owns the socket.
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!ready) ready = bootstrap();
  await ready;
  expressApp(req as express.Request, res as express.Response);
}
