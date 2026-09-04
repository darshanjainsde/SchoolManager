import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';
import { loadEnv } from '@skoolos/config';
import { configureApp } from './src/configure-app';
import { assertTenantIsolationEnforced } from '@skoolos/db';

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
  // Before serving anything: if the tenant role can bypass RLS, no amount of
  // application-level scoping is protecting one school from another.
  //
  // This runs HERE as well as in src/main.ts, and this is the copy that
  // matters — main.ts is the local entrypoint that binds a port, so a check
  // living only there never runs in the environments that hold real schools'
  // data. `entrypoint-guards.spec.ts` asserts both call it.
  //
  // One query per cold start: bootstrap() is cached across warm invocations.
  // It warns and continues when the database is simply unreachable, and only
  // refuses when the role genuinely has BYPASSRLS.
  await assertTenantIsolationEnforced({ allowBypass: env.NODE_ENV !== 'production' });
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
