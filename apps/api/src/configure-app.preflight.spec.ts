import express from 'express';
import request from 'supertest';
import { Controller, Get, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from './configure-app';
import { loadEnv } from '@skoolos/config';

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => ({ domain: { findMany: jest.fn().mockResolvedValue([]) } }),
}));

/**
 * ASKING PERMISSION COST AS MUCH AS THE CALL.
 *
 * The console lives on the school's host and this API lives on another, and
 * every request carries `Authorization` and `X-Skoolos-Host`. That makes it a
 * non-simple cross-origin request, so the browser must send an OPTIONS
 * preflight and wait for the answer before it may send the real one.
 *
 * Browsers keep that answer only as long as the response tells them to, and
 * without `Access-Control-Max-Age` the default is about five seconds. Every
 * click a person makes is more than five seconds after the last one, so in
 * practice the product paid for the question on every single call.
 *
 * Measured against the staging API before the fix: the preflight took 135 ms,
 * the request it preceded took 138 ms. Two round trips where one would do,
 * on every screen, all day.
 */
@Controller('anything')
class AnyController {
  @Get()
  get() {
    return { ok: true };
  }
}

@Module({ imports: [LoggerModule.forRoot({ pinoHttp: { enabled: false } })], controllers: [AnyController] })
class TestModule {}

describe('the CORS preflight is cacheable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, new ExpressAdapter(express()), { logger: false });
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const preflight = () =>
    request(app.getHttpServer())
      .options('/anything')
      .set('Origin', 'http://school.localhost')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-skoolos-host');

  it('tells the browser how long it may keep the answer', async () => {
    const res = await preflight();
    const maxAge = Number(res.headers['access-control-max-age']);
    // Without this header the browser re-asks every ~5 seconds, which doubles
    // the round trips of every authenticated screen in the product.
    expect(Number.isFinite(maxAge)).toBe(true);
    expect(maxAge).toBeGreaterThanOrEqual(3600);
  });

  it('still answers the preflight with the headers the client actually sends', async () => {
    // A cached preflight is only safe while it covers the real requests. If a
    // new header is added to the API client and not to this list, browsers
    // will refuse the call for up to max-age with no server-side trace.
    const res = await preflight();
    const allowed = (res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    for (const h of ['authorization', 'content-type', 'x-skoolos-host', 'x-forwarded-host', 'x-skoolos-client']) {
      expect(allowed).toContain(h);
    }
  });

  it('does not cache the preflight for an origin it refuses', async () => {
    const res = await request(app.getHttpServer())
      .options('/anything')
      .set('Origin', 'https://not-ours.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
