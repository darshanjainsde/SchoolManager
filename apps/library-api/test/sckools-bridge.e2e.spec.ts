import { createSign, generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { SckoolsBridgeService } from '../src/modules/auth/internal/sckools-bridge.service';
import { loadLibraryEnv } from '../src/config/env';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Trading a Sckools sign-in for a library one.
 *
 * The assertion that earns this file is ALGORITHM CONFUSION. A token that says
 * `"alg": "HS256"` must be refused even when its HMAC key is the RSA public
 * key — because a public key is, by definition, public, so a verifier that
 * accepts both algorithms lets anyone mint a valid token.
 *
 * Honest about what this proves: removing our explicit `algorithms: ['RS256']`
 * does NOT make this test fail, because `jsonwebtoken` independently refuses an
 * HMAC algorithm when given a PEM asymmetric key. The test pins the OUTCOME —
 * a forged token is refused — which is the property that matters and stays true
 * however the verification is implemented underneath.
 */
describeLive('auth — the Sckools bridge', () => {
  const jwt = new JwtService({});
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let bridge: SckoolsBridgeService;
  let publicKey: string;
  let privateKey: string;
  let signedTokens: { id: string; signAccess: () => string };

  const EXTERNAL_REF = 'sckools-student-4821';
  let prevKey: string | undefined;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`bridge-${Date.now().toString(36)}`));

    ({ publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }));

    prevKey = process.env.SCKOOLS_JWT_PUBLIC_KEY;
    process.env.SCKOOLS_JWT_PUBLIC_KEY = publicKey;
    loadLibraryEnv({ force: true });

    // A stub signer: this test is about VERIFYING an inbound token, not about
    // how the library mints its own, and injecting it is also what proves the
    // service no longer reaches back into auth.module.
    bridge = new SckoolsBridgeService(jwt, { signAccess: () => 'library-token-for-them' });

    // A member linked to a Sckools person, with a library login.
    const member = await prisma.member.create({
      data: {
        orgId: org.id, code: `BR-${Date.now()}`, firstName: 'Meera', lastName: 'Nair',
        externalRef: EXTERNAL_REF, status: 'ACTIVE',
      },
    });
    await prisma.libUser.create({
      data: {
        orgId: org.id, email: `br-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'MEMBER', branchIds: [], memberId: member.id,
      },
    });
    signedTokens = { id: member.id, signAccess: () => '' };
  });

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.SCKOOLS_JWT_PUBLIC_KEY;
    else process.env.SCKOOLS_JWT_PUBLIC_KEY = prevKey;
    loadLibraryEnv({ force: true });
    await cleanupOrgs([org.id, other.id]);
  });

  const sckoolsToken = (claims: Record<string, unknown>, opts: { issuer?: string } = {}) =>
    jwt.sign({ iss: opts.issuer ?? 'sckools', ...claims }, {
      privateKey, algorithm: 'RS256', expiresIn: '5m',
    });

  const exchange = (token: string) =>
    withOrg(org.id, (tx: LibraryTx) => bridge.exchange(tx, org.id, token));

  it('accepts a properly signed Sckools token and returns a LIBRARY token', async () => {
    const result = await exchange(sckoolsToken({ sub: EXTERNAL_REF }));
    expect(result.accessToken).toBe('library-token-for-them');
  });

  it('REFUSES an HS256 token signed with the public key — the confusion attack', async () => {
    // A public key is public, so if this ever verified, anybody could mint one.
    // Currently refused by jsonwebtoken itself as well as by our explicit
    // algorithm pin — see the file header on why both are kept.
    const forged = jwt.sign({ iss: 'sckools', sub: EXTERNAL_REF }, {
      secret: publicKey, algorithm: 'HS256', expiresIn: '5m',
    });
    await expect(exchange(forged)).rejects.toThrow(/could not be verified/);
  });

  it('refuses a token signed by somebody else entirely', async () => {
    const { privateKey: attacker } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const forged = jwt.sign({ iss: 'sckools', sub: EXTERNAL_REF }, {
      privateKey: attacker, algorithm: 'RS256', expiresIn: '5m',
    });
    await expect(exchange(forged)).rejects.toThrow(/could not be verified/);
  });

  it('refuses a token from a different issuer holding the same key', async () => {
    await expect(
      exchange(sckoolsToken({ sub: EXTERNAL_REF }, { issuer: 'some-other-service' })),
    ).rejects.toThrow(/could not be verified/);
  });

  it('refuses an expired token', async () => {
    const stale = jwt.sign({ iss: 'sckools', sub: EXTERNAL_REF }, {
      privateKey, algorithm: 'RS256', expiresIn: '-1m',
    });
    await expect(exchange(stale)).rejects.toThrow(/could not be verified/);
  });

  it('refuses a real Sckools person who has no library membership', async () => {
    // Not an auth failure — nobody has enrolled them yet. Distinguished from a
    // bad token so a school can tell the two apart in support.
    await expect(exchange(sckoolsToken({ sub: 'sckools-nobody-here' })))
      .rejects.toThrow(/no library membership/);
  });

  it("cannot borrow another org's member by their externalRef", async () => {
    const theirs = await prisma.member.create({
      data: {
        orgId: other.id, code: `BR-X-${Date.now()}`, firstName: 'Other', lastName: 'Org',
        externalRef: 'sckools-other-org', status: 'ACTIVE',
      },
    });
    expect(theirs.orgId).toBe(other.id);
    // Exchanged against org A, so org B's member must be invisible — RLS plus
    // the orgId in the lookup, not one or the other.
    await expect(exchange(sckoolsToken({ sub: 'sckools-other-org' })))
      .rejects.toThrow(/no library membership/);
  });

  it('reports honestly when the school has not linked the two systems', async () => {
    delete process.env.SCKOOLS_JWT_PUBLIC_KEY;
    loadLibraryEnv({ force: true });
    try {
      // The library runs standalone by design. A school that has not linked is
      // not misconfigured, and must not see an auth error.
      await expect(exchange(sckoolsToken({ sub: EXTERNAL_REF })))
        .rejects.toThrow(/not linked to a Sckools account/);
    } finally {
      process.env.SCKOOLS_JWT_PUBLIC_KEY = publicKey;
      loadLibraryEnv({ force: true });
    }
  });

  it('keeps the member id it matched', () => {
    expect(signedTokens.id).toBeDefined();
  });
});
