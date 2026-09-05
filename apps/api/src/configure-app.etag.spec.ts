import express from 'express';
import request from 'supertest';
import { Controller, Get, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from './configure-app';
import { loadEnv } from '@skoolos/config';

/**
 * A 304 is a CORS failure in disguise.
 *
 * Express ETags a JSON body and sends `Cache-Control: must-revalidate`, so the
 * browser sends If-None-Match on the next call and gets a 304 back — written by
 * Express itself, WITHOUT the CORS headers enableCors put on the 200. The
 * console is cross-origin to the API, so the browser drops that 304 and the
 * fetch rejects with "Failed to fetch": no status to log, nothing in the API's
 * own logs but a healthy 304.
 *
 * It only hits endpoints whose body is stable, which is what made it look
 * intermittent — /owner/marketing-config is the same six prices every time and
 * so failed always, while /owner/overview's moving counts mostly hid it.
 */
@Controller('stable')
class StableController {
  @Get()
  get() {
    return { same: 'every time' };
  }
}

// configureApp resolves the pino Logger, so the test module must provide it.
@Module({ imports: [LoggerModule.forRoot({ pinoHttp: { enabled: false } })], controllers: [StableController] })
class TestModule {}

describe('API responses are not conditionally cacheable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(TestModule, new ExpressAdapter(express()), { logger: false });
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sends no ETag, so the browser never revalidates', async () => {
    const res = await request(app.getHttpServer()).get('/stable').expect(200);
    expect(res.headers.etag).toBeUndefined();
  });

  it('tells the browser not to store the response at all', async () => {
    // Express's ETag setting alone is not enough in production: Vercel's edge
    // attaches its OWN ETag, so the browser keeps revalidating and keeps
    // getting a CORS-less 304. no-store is what stops the conditional request
    // from being sent in the first place.
    const res = await request(app.getHttpServer()).get('/stable').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 200 even when the client offers a matching If-None-Match', async () => {
    // The exact shape that broke: a client holding a previous ETag. Without the
    // fix Express short-circuits to 304 and strips the CORS headers with it.
    const first = await request(app.getHttpServer()).get('/stable').expect(200);
    const again = await request(app.getHttpServer())
      .get('/stable')
      .set('If-None-Match', 'W/"whatever-the-client-still-holds"')
      .set('Origin', 'https://owner.example.com');

    // 304 is the whole bug: Express writes it itself, bypassing the CORS
    // middleware, so the browser rejects a response the server thinks it sent
    // successfully. Staying on 200 is what keeps the CORS headers attached.
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });
});
