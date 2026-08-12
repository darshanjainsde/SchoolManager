import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';
import { configureApp } from './src/configure-app';

/**
 * Point Prisma at the query engine that ships beside this bundle.
 *
 * ncc inlines JavaScript but cannot inline a native `.node` binary, so the
 * engine is copied next to the bundle by `scripts/copy-prisma-engine.mjs`.
 * Prisma still does not find it: it searches `/var/task/generated/client`,
 * `/var/task/apps/library-api` and a few other places — none of which is the
 * bundle's own directory — and every request 500s with
 * "could not locate the Query Engine for runtime rhel-openssl-3.0.x".
 *
 * Set here rather than as a Vercel environment variable because Prisma
 * validates this path during `prisma generate` at BUILD time, when the
 * deployed path does not exist yet. Setting it as a project env var failed the
 * whole build with "provided path ... can't be resolved".
 *
 * Safe to run at module load: both clients in `@library/db` are lazy, so no
 * PrismaClient exists yet. Guarded on the file existing so a local run, where
 * Prisma resolves the darwin engine normally, is untouched.
 */
const bundledEngine = join(__dirname, 'libquery_engine-rhel-openssl-3.0.x.so.node');
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY && existsSync(bundledEngine)) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = bundledEngine;
}

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
