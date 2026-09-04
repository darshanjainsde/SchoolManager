import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { loadEnv } from '@skoolos/config';
import { createHash, randomUUID } from 'node:crypto';

/**
 * The owner console's session lifecycle.
 *
 * Written after an audit found there was no /owner/auth/logout at all: the
 * console cleared a client store and navigated, while the refresh cookie
 * stayed in the browser with its row unrevoked. A replayed refresh kept
 * minting full platform tokens — over every school — for up to 30 days after
 * "sign out", with no way to revoke it.
 */
describe('owner session', () => {
  let app: INestApplication;
  let ownerHost: string;
  let ownerId: string;

  const env = loadEnv();

  beforeAll(async () => {
    ownerHost = env.PLATFORM_OWNER_HOST;
    const db = getPlatformPrisma();
    const existing = await db.user.findFirst({ where: { schoolId: null, role: 'OWNER' } });
    ownerId = existing?.id ?? '';

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const owner = () => ({ 'X-Skoolos-Host': ownerHost });

  it('exposes a logout endpoint at all — the whole point of this suite', async () => {
    const res = await request(app.getHttpServer())
      .post('/owner/auth/logout')
      .set(owner())
      .send({});
    // 204 with or without a cookie: it must never report whether a token was
    // live, or it becomes an oracle.
    expect(res.status).toBe(204);
  });

  it('answers 204 even with a nonsense token, so it cannot be used to probe', async () => {
    const res = await request(app.getHttpServer())
      .post('/owner/auth/logout')
      .set(owner())
      .send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(204);
  });

  it('clears the refresh cookie on the way out', async () => {
    const res = await request(app.getHttpServer())
      .post('/owner/auth/logout')
      .set(owner())
      .send({});
    const setCookie = String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('skoolos_ort=');
  });

  it('is still refused from a non-owner host', async () => {
    await request(app.getHttpServer())
      .post('/owner/auth/logout')
      .set({ 'X-Skoolos-Host': 'raffles.localhost' })
      .send({})
      .expect(403);
  });

  describe('revoking by family', () => {
    // Calls the real service. An earlier draft of this test performed the
    // updateMany itself and asserted the result — which would have passed with
    // logout() deleted, proving nothing.
    it('revokes every live token in the family, not just the one presented', async () => {
      if (!ownerId) return; // no owner user seeded in this environment
      const db = getPlatformPrisma();
      const { OwnerAuthService } = await import('../src/modules/owner/internal/owner-auth.service');
      const svc = app.get(OwnerAuthService);

      const familyId = randomUUID();
      const presented = `presented-${randomUUID()}`;
      const sibling = `sibling-${randomUUID()}`;
      const hash = (v: string) => createHash('sha256').update(v).digest('hex');

      const made = await Promise.all(
        [presented, sibling].map((tok) =>
          db.refreshToken.create({
            data: {
              userId: ownerId, schoolId: null, familyId,
              tokenHash: hash(tok),
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          }),
        ),
      );

      await svc.logout(presented);

      const after = await db.refreshToken.findMany({ where: { familyId } });
      expect(after).toHaveLength(2);
      // The sibling is the point: a stolen-and-rotated token lives in the same
      // family, and revoking only the row the victim holds leaves it alive.
      expect(after.every((r) => r.revokedAt !== null)).toBe(true);

      await db.refreshToken.deleteMany({ where: { id: { in: made.map((r) => r.id) } } });
    });

    it('does nothing when handed a token that matches no row', async () => {
      const { OwnerAuthService } = await import('../src/modules/owner/internal/owner-auth.service');
      await expect(app.get(OwnerAuthService).logout(`ghost-${randomUUID()}`)).resolves.toBeUndefined();
    });
  });
});
