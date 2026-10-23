const db: Record<string, Record<string, jest.Mock>> = {
  promoter: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({ PLATFORM_HOST: 'sckools.com', JWT_PLATFORM_ACCESS_SECRET: 'platform-secret-platform-secret-32' }) }));
jest.mock('../../common/notifications/run-in-background', () => ({ runInBackground: (work: () => Promise<unknown>) => { void work().catch(() => undefined); } }));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OtpService } from '../../common/otp/otp.service';
import type { ReferralsService } from './referrals.service';
import { PromoterAuthService } from './promoter-auth.service';
import { PromoterJwtGuard, promoterSecret } from './promoter-jwt.guard';

const jwt = new JwtService({});
const otp = { startEmail: jest.fn(), start: jest.fn(), check: jest.fn() };
const mail = { code: jest.fn().mockResolvedValue(true), welcome: jest.fn().mockResolvedValue(true) };
const referrals = { mail, uniqueCode: jest.fn().mockResolvedValue('NEHA12') };
const PROMOTER = { id: 'p1', name: 'Neha Gupta', email: 'neha@example.com', phoneE164: null, status: 'ACTIVE', tokenVersion: 3 };

let svc: PromoterAuthService;
beforeEach(() => {
  for (const t of Object.values(db)) for (const f of Object.values(t)) f.mockReset();
  for (const f of Object.values(otp)) f.mockReset();
  svc = new PromoterAuthService(jwt, otp as unknown as OtpService, referrals as unknown as ReferralsService);
});

describe('asking for a code', () => {
  it('by email: lower-cases the address, carries the code by mail, and says whether an account exists', async () => {
    db.promoter.findUnique.mockResolvedValue(null);
    otp.startEmail.mockImplementation(async (_p: string, email: string, _c: unknown, carry: (code: string) => Promise<boolean>) => { await carry('482913'); return { challengeId: 'c1', phoneMasked: 'ne•••@example.com', sentVia: ['email'], expiresIn: 600 }; });
    const out = await svc.start({ channel: 'email', email: 'Neha@Example.com' }, '1.2.3.4');
    expect(otp.startEmail.mock.calls[0][0]).toBe('PROMOTER');
    expect(otp.startEmail.mock.calls[0][1]).toBe('neha@example.com');
    expect(mail.code).toHaveBeenCalledWith('Neha@Example.com'.toLowerCase(), '482913');
    expect(out).toMatchObject({ challengeId: 'c1', channel: 'email', exists: false });
  });

  it('by WhatsApp: the number is normalised, the challenge has no school, and a bad number is refused before any send', async () => {
    db.promoter.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    otp.start.mockResolvedValue({ challengeId: 'c2', phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 });
    const out = await svc.start({ channel: 'whatsapp', phone: '98765 43210' }, null);
    expect(otp.start).toHaveBeenCalledWith('PROMOTER', '+919876543210', { schoolId: null, ip: null });
    expect(out).toMatchObject({ channel: 'whatsapp', exists: true });
    await expect(svc.start({ channel: 'whatsapp', phone: '12 34' }, null)).rejects.toMatchObject({ response: { field: 'phone' } });
    expect(otp.start).toHaveBeenCalledTimes(1);
  });

  it('a closed account cannot even ask for a code', async () => {
    db.promoter.findUnique.mockResolvedValue({ status: 'REMOVED' });
    await expect(svc.start({ channel: 'email', email: 'x@y.in' }, null)).rejects.toMatchObject({ response: { code: 'PROMOTER_SUSPENDED' } });
    expect(otp.startEmail).not.toHaveBeenCalled();
  });
});

describe('verifying a code', () => {
  it('a first-time address needs a name, then opens the account and mints a promoter token', async () => {
    otp.check.mockResolvedValue({ id: 'c1', phone: 'neha@example.com', purpose: 'PROMOTER' });
    db.promoter.findUnique.mockResolvedValue(null);
    await expect(svc.verify({ challengeId: 'c1', code: '482913' })).rejects.toMatchObject({ response: { code: 'PROMOTER_NAME_REQUIRED' } });
    expect(db.promoter.create).not.toHaveBeenCalled();
    // The challenge was only peeked at, never spent: the same code works once the name arrives.
    expect(otp.check).toHaveBeenCalledTimes(1);
    expect(otp.check.mock.calls[0][3]).toEqual({ consume: false });
    db.promoter.create.mockResolvedValue({ ...PROMOTER, tokenVersion: 0 });
    const s = await svc.verify({ challengeId: 'c1', code: '482913', name: ' Neha Gupta ', city: 'Bikaner' });
    expect(db.promoter.create.mock.calls[0][0].data).toMatchObject({ code: 'NEHA12', name: 'Neha Gupta', email: 'neha@example.com', phoneE164: null, city: 'Bikaner' });
    expect(s.isNew).toBe(true);
    const payload = jwt.verify(s.accessToken, { secret: promoterSecret('platform-secret-platform-secret-32'), audience: 'promoter' }) as { sub: string; ver: number; aud: string };
    expect(payload).toMatchObject({ sub: 'p1', ver: 0, aud: 'promoter' });
    // The derived secret is not the platform secret: a promoter token can never pass the owner guard.
    expect(() => jwt.verify(s.accessToken, { secret: 'platform-secret-platform-secret-32' })).toThrow();
  });

  it('a known WhatsApp number signs straight in; a closed account is refused', async () => {
    otp.check.mockResolvedValue({ id: 'c2', phone: '+919876543210', purpose: 'PROMOTER' });
    db.promoter.findUnique.mockResolvedValue({ ...PROMOTER, email: null, phoneE164: '+919876543210' });
    db.promoter.update.mockResolvedValue({ ...PROMOTER, email: null, phoneE164: '+919876543210' });
    const s = await svc.verify({ challengeId: 'c2', code: '000000' });
    expect(db.promoter.findUnique.mock.calls[0][0].where).toEqual({ phoneE164: '+919876543210' });
    expect(s.isNew).toBe(false);
    db.promoter.findUnique.mockResolvedValue({ ...PROMOTER, status: 'REMOVED' });
    await expect(svc.verify({ challengeId: 'c2', code: '000000' })).rejects.toMatchObject({ response: { code: 'PROMOTER_SUSPENDED' } });
  });
});

describe('the guard', () => {
  const ctxFor = (auth?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: auth } }) }) }) as unknown as ExecutionContext;
  const token = (ver: number) => jwt.sign({ sub: 'p1', aud: 'promoter', ver, jti: 'j' }, { secret: promoterSecret('platform-secret-platform-secret-32'), expiresIn: 60 });

  it('admits a live token whose version matches, suspended included; refuses removed, stale and foreign tokens', async () => {
    const guard = new PromoterJwtGuard(jwt);
    db.promoter.findUnique.mockResolvedValue({ ...PROMOTER, status: 'SUSPENDED' });
    expect(await guard.canActivate(ctxFor(`Bearer ${token(3)}`))).toBe(true);
    await expect(guard.canActivate(ctxFor(`Bearer ${token(2)}`))).rejects.toBeInstanceOf(UnauthorizedException);
    db.promoter.findUnique.mockResolvedValue({ ...PROMOTER, status: 'REMOVED' });
    await expect(guard.canActivate(ctxFor(`Bearer ${token(3)}`))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    const foreign = jwt.sign({ sub: 'p1', aud: 'platform', role: 'OWNER', jti: 'j' }, { secret: 'platform-secret-platform-secret-32', expiresIn: 60 });
    await expect(guard.canActivate(ctxFor(`Bearer ${foreign}`))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
