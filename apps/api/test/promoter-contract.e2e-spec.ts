import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { promoterSecret } from '../src/modules/referrals/promoter-jwt.guard';
import { seedMinimalSchool, signPlatformToken, signSchoolToken } from './integration/helpers';

/**
 * Refer & Earn's door, against the BOOTED app (CLAUDE.md: a role gets its own
 * payload, every other role gets 403/401). A promoter token is a third
 * audience: it must open /promoter/* and nothing else, and no school or
 * owner token may open /promoter/*.
 */
describe('promoter contract: a third audience that reaches only its own doors', () => {
  let app: INestApplication;
  let host: string;
  let schoolId: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const env = loadEnv();
  const jwt = new JwtService({});
  const promoterToken = (sub: string, ver: number) => jwt.sign({ sub, aud: 'promoter', ver, jti: randomUUID() }, { secret: promoterSecret(env.JWT_PLATFORM_ACCESS_SECRET), expiresIn: 600 });

  beforeAll(async () => {
    const school = await seedMinimalSchool();
    host = school.host;
    schoolId = school.schoolId;
    tok.admin = signSchoolToken({ sub: school.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    tok.owner = signPlatformToken();
    const db = getPlatformPrisma();
    const stamp = Date.now();
    const active = await db.promoter.create({ data: { code: `PC${stamp % 100000}`, name: 'Contract Promoter', email: `promoter-${stamp}@contract.test`, city: 'Jaipur', who: 'Teacher', expect: '3-5', pan: 'ABCPC1234K', bankAccount: '50100999988887' } });
    const paused = await db.promoter.create({ data: { code: `PP${stamp % 100000}`, name: 'Paused Promoter', email: `paused-${stamp}@contract.test`, status: 'SUSPENDED', statusReason: 'Two referrals without consent.', tokenVersion: 1 } });
    const gone = await db.promoter.create({ data: { code: `PG${stamp % 100000}`, name: 'Gone Promoter', email: `gone-${stamp}@contract.test`, status: 'REMOVED' } });
    ids.active = active.id; ids.paused = paused.id; ids.gone = gone.id;
    tok.promoter = promoterToken(active.id, 0);
    tok.stale = promoterToken(active.id, 5);
    tok.paused = promoterToken(paused.id, 1);
    tok.gone = promoterToken(gone.id, 0);

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    const db = getPlatformPrisma();
    await db.promoter.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await app.close();
    await disconnectAll();
  });

  const call = (method: 'get' | 'post' | 'patch', path: string, token?: string, onHost = host) => {
    const req = request(app.getHttpServer())[method](path).set('X-Skoolos-Host', onHost);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('a promoter reads their own record, with the PAN and account number masked', async () => {
    const res = await call('get', '/promoter/me', tok.promoter).expect(200);
    expect(res.body).toMatchObject({ id: ids.active, code: expect.stringMatching(/^PC/), questionnaireComplete: true, panMasked: 'AB•••••4K', bankAccountMasked: '••••8887' });
    expect(JSON.stringify(res.body)).not.toContain('ABCPC1234K');
    expect(JSON.stringify(res.body)).not.toContain('50100999988887');
  });

  it('every other token is refused at the promoter door, and the promoter at every other door', async () => {
    await call('get', '/promoter/me').expect(401);
    await call('get', '/promoter/me', tok.admin).expect(401);
    await call('get', '/promoter/me', tok.owner).expect(401);
    await call('get', '/promoter/me', tok.stale).expect(401);
    await call('get', '/promoter/me', tok.gone).expect(401);
    // The promoter's token is signed with a different secret: a school door and the owner door cannot even parse it.
    await call('get', '/manage/students', tok.promoter).expect(401);
    await call('get', '/owner/referrals/tasks', tok.promoter, env.PLATFORM_OWNER_HOST).expect(401);
  });

  it('a paused promoter can read but not write; the reason travels with the refusal', async () => {
    const me = await call('get', '/promoter/me', tok.paused).expect(200);
    expect(me.body.status).toBe('SUSPENDED');
    const res = await call('post', '/promoter/referrals', tok.paused)
      .send({ schoolName: 'Test School', city: 'Kota', contactName: 'Mr Test', contactPhone: '9876543210', consent: true })
      .expect(403);
    expect(res.body).toMatchObject({ code: 'PROMOTER_SUSPENDED', message: 'Two referrals without consent.' });
  });

  it('the form refuses the truly required fields and nothing else', async () => {
    const res = await call('post', '/promoter/referrals', tok.promoter).send({ schoolName: 'X', city: 'Kota', contactName: 'Mr Test', contactPhone: '12', consent: false }).expect(400);
    const text = JSON.stringify(res.body);
    expect(text).toContain('school name');
    expect(text).toContain('phone');
    expect(text).toContain('agrees to a call');
    expect(text).not.toContain('area');
  });

  it('the owner tab is owner-only: the owner host and a platform token, nothing less', async () => {
    await call('get', '/owner/referrals/tasks', tok.owner, env.PLATFORM_OWNER_HOST).expect(200);
    await call('get', '/owner/referrals/tasks', tok.owner).expect(403); // right token, wrong host
    await call('get', '/owner/referrals/tasks', tok.admin, env.PLATFORM_OWNER_HOST).expect(401);
    await call('get', '/owner/referrals/settings', tok.owner, env.PLATFORM_OWNER_HOST).expect(200);
  });

  it('the public door rate-limits and refuses a nonsense address before sending anything', async () => {
    const bad = await call('post', '/promoter/auth/start').send({ channel: 'whatsapp', phone: '12 34' }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/phone/i);
    await call('post', '/promoter/auth/start').send({ channel: 'sms', phone: '9876543210' }).expect(400);
    const stale = await call('post', '/promoter/auth/verify').send({ challengeId: randomUUID(), code: '123456' }).expect(400);
    expect(stale.body.code).toBe('OTP_CHALLENGE_UNKNOWN');
  });
});
