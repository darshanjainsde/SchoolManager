import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Query strings are text, and the global ValidationPipe does NOT run with
 * `enableImplicitConversion`. So `?take=50` reaches an `@IsInt()` field as the
 * string "50" and is rejected — the alumni roll 400'd on its own first page
 * load, and the directory 400'd the moment anybody filtered by batch year.
 *
 * The fix is a per-field `@Type(() => Number)`, and the risk of that fix is
 * that it quietly accepts nonsense instead. So both halves are tested: the
 * good value passes, and the junk value is still refused.
 */
describe('numeric query params on the alumni routes', () => {
  let app: INestApplication; let host: string; let adminToken: string;
  beforeAll(async () => {
    const s = await seedMinimalSchool();
    host = s.host;
    adminToken = signSchoolToken({ sub: s.adminUserId, schoolId: s.schoolId, role: 'SCHOOL_ADMIN' });
    // ALUMNI belongs to no tier — without the override the feature guard 403s
    // before validation is ever reached, and the probe proves nothing.
    await getPlatformPrisma().featureOverride.create({
      data: { schoolId: s.schoolId, featureKey: 'ALUMNI', enabled: true },
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app.close(); await disconnectAll(); });

  const roll = (qs: string) =>
    request(app.getHttpServer()).get(`/manage/alumni${qs}`)
      .set('Host', host).set('Authorization', `Bearer ${adminToken}`);

  it('accepts ?take= and ?skip= as a browser actually sends them', async () => {
    expect((await roll('?take=50&skip=0&q=rao')).status).toBe(200);
  });

  it('accepts ?batchYear= as a string', async () => {
    expect((await roll('?batchYear=2014')).status).toBe(200);
  });

  it('still refuses junk rather than coercing it to NaN', async () => {
    expect((await roll('?take=abc')).status).toBe(400);
  });

  it('still enforces the ceiling on take', async () => {
    expect((await roll('?take=9999')).status).toBe(400);
  });

  it('still refuses an out-of-range batch year', async () => {
    expect((await roll('?batchYear=1200')).status).toBe(400);
  });

  it('still refuses an unknown parameter', async () => {
    expect((await roll('?nonsense=1')).status).toBe(400);
  });
});
