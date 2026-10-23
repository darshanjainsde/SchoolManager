const db: Record<string, Record<string, jest.Mock>> = {
  marketingConfig: { upsert: jest.fn(), findUnique: jest.fn() },
  promoter: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  referral: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  referralEvent: { create: jest.fn() },
  referralTask: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  referralPayout: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  marketingLead: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  school: { findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({ PLATFORM_HOST: 'sckools.com', JWT_PLATFORM_ACCESS_SECRET: 'x'.repeat(32) }) }));
jest.mock('../../common/notifications/run-in-background', () => ({ runInBackground: (work: () => Promise<unknown>) => { void work().catch(() => undefined); } }));

import { ApiError } from '../../common/errors/api-error';
import type { MailService } from '../../common/mail/mail.service';
import type { Promoter } from '@skoolos/db';
import { ReferralsService, e164 } from './referrals.service';

const CONFIG = { id: 'default', contactEmail: 'admin@sckools.com', referralLadder: { '1-2': 8, '3-5': 10, '6-10': 12, '10+': 15 }, referralCapMinor: 50_000_00, referralPayoutDays: 30, referralAttributionDays: 90, referralTdsPct: 2 };
const PROMOTER = { id: 'p1', code: 'RAHUL42', name: 'Rahul Mehta', email: 'rahul@example.com', phoneE164: null, status: 'ACTIVE', who: 'Tuition owner', expect: '6-10', commissionPct: 12, commissionCapMinor: null, payoutDetailsAt: new Date('2026-10-01'), tokenVersion: 0 } as unknown as Promoter;
const REF_INPUT = { schoolName: "St. Mary's Convent", city: 'Jaipur', contactName: 'Mrs Kapoor', contactPhone: '+91 98111 22334', consent: true };

let svc: ReferralsService;
const sendLetter = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  for (const t of Object.values(db)) for (const f of Object.values(t)) f.mockReset();
  db.marketingConfig.upsert.mockResolvedValue(CONFIG);
  db.marketingConfig.findUnique.mockResolvedValue(CONFIG);
  db.referral.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'r-new', ...data }));
  db.referral.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'r1', ...data }));
  db.referralTask.updateMany.mockResolvedValue({ count: 1 });
  db.referralTask.findFirst.mockResolvedValue(null);
  db.referralTask.create.mockResolvedValue({ id: 't1', createdAt: new Date() });
  db.marketingLead.findFirst.mockResolvedValue(null);
  db.marketingLead.findMany.mockResolvedValue([]);
  db.school.findFirst.mockResolvedValue(null);
  db.referral.findFirst.mockResolvedValue(null);
  svc = new ReferralsService({ sendLetter } as unknown as MailService);
});

describe('createReferral', () => {
  it('a fresh school is LOGGED, keyed, held for the attribution window, and becomes an owner task', async () => {
    db.referral.findFirst.mockResolvedValue(null);
    const r = await svc.createReferral(PROMOTER, REF_INPUT as never);
    expect(r.status).toBe('LOGGED');
    const data = db.referral.create.mock.calls[0][0].data;
    expect(data.schoolKey).toBe('st marys convent|jaipur');
    expect(data.contactPhoneKey).toBe('9811122334');
    expect(data.tasks).toEqual({ create: { kind: 'REFERRAL', promoterId: 'p1' } });
    const until = data.attributionUntil as Date;
    expect(Math.round((until.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it('the same school by another promoter is REJECTED on the spot, without naming who holds it, and makes no task', async () => {
    db.referral.findFirst.mockResolvedValue({ id: 'r0', promoterId: 'p2', status: 'ACCEPTED', attributionUntil: new Date(Date.now() + 86_400_000), createdAt: new Date('2026-10-03') });
    const r = await svc.createReferral(PROMOTER, { ...REF_INPUT, schoolName: 'st marys  convent' } as never);
    expect(r.status).toBe('REJECTED');
    expect(r.statusReason).toBe('Already referred by another promoter on 3 Oct 2026.');
    expect(JSON.stringify(r)).not.toContain('Priya');
    expect(db.referral.create.mock.calls[0][0].data.tasks).toBeUndefined();
    // The duplicate query holds only live referrals: rejected and lost ones do not block.
    expect(JSON.stringify(db.referral.findFirst.mock.calls[0][0].where)).toContain('"status":{"in":[');
  });

  it('a lapsed LOGGED referral by someone else is retired, and the school is logged afresh', async () => {
    db.referral.findFirst.mockResolvedValue({ id: 'r-old', promoterId: 'p2', status: 'LOGGED', attributionUntil: new Date(Date.now() - 86_400_000), createdAt: new Date('2026-06-01') });
    const r = await svc.createReferral(PROMOTER, REF_INPUT as never);
    expect(r.status).toBe('LOGGED');
    expect(db.referral.update.mock.calls[0][0]).toMatchObject({ where: { id: 'r-old' }, data: { status: 'LOST' } });
  });

  it('two promoters logging one school in the same instant: the unique index lets one through, the other is rejected', async () => {
    const { Prisma } = jest.requireActual('@skoolos/db');
    db.referral.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    db.referral.create.mockImplementationOnce(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'r-rej', ...data }));
    const r = await svc.createReferral(PROMOTER, REF_INPUT as never);
    expect(r.status).toBe('REJECTED');
    expect(r.statusReason).toMatch(/another promoter just now/);
  });

  it('a school already in the lead pipeline (phone typed any way) or already live is not referrable', async () => {
    db.marketingLead.findMany.mockResolvedValue([{ phone: '+91 98111-22334', school: null, createdAt: new Date('2026-09-01') }]);
    expect((await svc.createReferral(PROMOTER, REF_INPUT as never)).statusReason).toBe('This school is already in touch with Sckools.');
    db.marketingLead.findMany.mockResolvedValue([{ phone: '0000000000', school: "ST MARY'S CONVENT", createdAt: new Date('2026-09-01') }]);
    expect((await svc.createReferral(PROMOTER, REF_INPUT as never)).statusReason).toBe('This school is already in touch with Sckools.');
    db.marketingLead.findMany.mockResolvedValue([]);
    db.school.findFirst.mockResolvedValue({ id: 's1' });
    expect((await svc.createReferral(PROMOTER, REF_INPUT as never)).statusReason).toMatch(/already live/);
  });

  it('a suspended promoter cannot log', async () => {
    await expect(svc.createReferral({ ...PROMOTER, status: 'SUSPENDED', statusReason: 'Paused.' } as never, REF_INPUT as never)).rejects.toMatchObject({ response: { code: 'PROMOTER_SUSPENDED' } });
  });
});

describe('accept and reject', () => {
  const LOGGED = { id: 'r1', status: 'LOGGED', promoterId: 'p1', promoter: PROMOTER, contactName: 'Mrs Kapoor', contactPhone: '9811122334', contactPhoneKey: '9811122334', schoolKey: 'st marys convent|jaipur', contactEmail: null, schoolName: "St. Mary's Convent", planInterest: 'Standard', howKnown: 'PTA', attributionUntil: new Date(Date.now() + 86_400_000) };

  it('accepting a lapsed referral, or one another promoter now holds, is refused with the reason', async () => {
    db.referral.findUnique.mockResolvedValue({ ...LOGGED, attributionUntil: new Date(Date.now() - 1000) });
    await expect(svc.accept('r1')).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION', message: expect.stringMatching(/lapsed/) } });
    db.referral.findUnique.mockResolvedValue(LOGGED);
    db.referral.findFirst.mockResolvedValue({ id: 'r-other', promoterId: 'p2', status: 'ACCEPTED', attributionUntil: new Date(Date.now() + 86_400_000), createdAt: new Date('2026-10-02') });
    await expect(svc.accept('r1')).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION', message: expect.stringMatching(/another promoter/) } });
    expect(db.marketingLead.create).not.toHaveBeenCalled();
    // The exclusion keeps the referral from matching itself.
    expect(db.referral.findFirst.mock.calls[0][0].where.AND).toContainEqual({ id: { not: 'r1' } });
  });

  it('accepting a LOGGED referral creates the lead with source referral:CODE and links it', async () => {
    db.referral.findUnique.mockResolvedValue(LOGGED);
    db.marketingLead.create.mockResolvedValue({ id: 'lead-1' });
    const out = await svc.accept('r1');
    expect(db.marketingLead.create.mock.calls[0][0].data.source).toBe('referral:RAHUL42');
    expect(out.status).toBe('ACCEPTED');
    expect(db.referral.update.mock.calls[0][0].data.leadId).toBe('lead-1');
    expect(db.referralTask.updateMany).toHaveBeenCalled();
  });

  it('accepting twice is refused as a bad transition', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'ACCEPTED', promoter: PROMOTER });
    await expect(svc.accept('r1')).rejects.toBeInstanceOf(ApiError);
  });

  it('a rejection carries its reason to the timeline and to the lead', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'CONTACTED', leadId: 'lead-1', promoter: PROMOTER, schoolName: 'X' });
    db.marketingLead.findUnique.mockResolvedValue({ status: 'CONTACTED' });
    await svc.reject('r1', 'Already in talks through another route.');
    expect(db.referral.update.mock.calls[0][0].data.events.create.body).toBe('Already in talks through another route.');
    expect(db.marketingLead.update.mock.calls[0][0].data.status).toBe('LOST');
  });
});

describe('the money path', () => {
  it('LIVE needs the invoice and the rate, then creates the one payout with TDS and a due date', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'WON', promoterId: 'p1', leadId: null, promoter: PROMOTER, payout: null, schoolName: 'Beacon', statusReason: null, wonSchoolId: null });
    const out = await svc.setStage('r1', { status: 'LIVE', invoiceMinor: 44_991_00_00 } as never);
    const data = db.referral.update.mock.calls[0][0].data;
    expect(out.status).toBe('PAYOUT_DUE');
    expect(data.rewardMinor).toBe(50_000_00); // 12% of ₹44.99L is ₹5.4L → capped at the platform's ₹50k (a row from before caps were definite)
    expect(data.payout.create).toMatchObject({ promoterId: 'p1', grossMinor: 50_000_00, tdsMinor: 1_000_00, netMinor: 49_000_00 });
    expect(Math.round((data.payout.create.dueOn.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });

  it('a cap of 0 on the promoter means no cap: the full percentage is paid', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'WON', promoterId: 'p1', leadId: null, promoter: { ...PROMOTER, commissionCapMinor: 0 }, payout: null, schoolName: 'Beacon' });
    await svc.setStage('r1', { status: 'LIVE', invoiceMinor: 12_49_500_00 } as never);
    expect(db.referral.update.mock.calls[0][0].data.rewardMinor).toBe(1_49_940_00); // 12% of ₹12,49,500, nothing capped
  });

  it('once a payout exists the referral cannot be closed by hand', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'PAYOUT_DUE', promoter: PROMOTER, payout: { id: 'y1' } });
    await expect(svc.setStage('r1', { status: 'LOST' } as never)).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
    await expect(svc.reject('r1', 'changed my mind')).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
  });

  it('LIVE without a rate on the promoter is refused and says so', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'WON', promoter: { ...PROMOTER, commissionPct: null }, payout: null });
    await expect(svc.setStage('r1', { status: 'LIVE', invoiceMinor: 100 } as never)).rejects.toMatchObject({ response: { code: 'REFERRAL_RATE_NOT_SET' } });
  });

  it('a second payout for the same referral can never be created', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'WON', promoter: PROMOTER, payout: { id: 'y1' } });
    await expect(svc.setStage('r1', { status: 'LIVE', invoiceMinor: 100 } as never)).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
  });

  it('a promoter with no payout details gets a KYC task when a school goes live', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'WON', promoterId: 'p1', promoter: { ...PROMOTER, payoutDetailsAt: null }, payout: null, schoolName: 'B' });
    await svc.setStage('r1', { status: 'LIVE', invoiceMinor: 1_00_000_00 } as never);
    expect(db.referralTask.create.mock.calls[0][0].data).toMatchObject({ kind: 'KYC', promoterId: 'p1' });
  });

  it('backwards moves and moves out of a closed referral are refused', async () => {
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'DEMO_DONE', promoter: PROMOTER, payout: null });
    await expect(svc.setStage('r1', { status: 'CONTACTED' } as never)).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
    db.referral.findUnique.mockResolvedValue({ id: 'r1', status: 'PAID', promoter: PROMOTER, payout: null });
    await expect(svc.setStage('r1', { status: 'LOST' } as never)).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
  });

  it('markPaid needs payout details, writes the UTR, and closes the referral as PAID', async () => {
    db.referralPayout.findUnique.mockResolvedValue({ id: 'y1', status: 'DUE', referralId: 'r1', netMinor: 49_000_00, promoter: { ...PROMOTER, payoutDetailsAt: null }, referral: { status: 'PAYOUT_DUE', schoolName: 'B' } });
    await expect(svc.markPaid('y1', { utr: 'UTR123456' })).rejects.toMatchObject({ response: { code: 'PAYOUT_DETAILS_MISSING' } });
    db.referralPayout.findUnique.mockResolvedValue({ id: 'y1', status: 'DUE', referralId: 'r1', netMinor: 49_000_00, promoter: PROMOTER, referral: { status: 'LOST', schoolName: 'B' } });
    await expect(svc.markPaid('y1', { utr: 'UTR123456' })).rejects.toMatchObject({ response: { code: 'REFERRAL_BAD_TRANSITION' } });
    db.referralPayout.findUnique.mockResolvedValue({ id: 'y1', status: 'DUE', referralId: 'r1', netMinor: 49_000_00, promoter: PROMOTER, referral: { status: 'PAYOUT_DUE', schoolName: 'B' } });
    db.referralPayout.update.mockResolvedValue({ id: 'y1', status: 'PAID' });
    await svc.markPaid('y1', { utr: 'UTR123456', paidOn: '2026-11-18' });
    expect(db.referralPayout.update.mock.calls[0][0].data).toMatchObject({ status: 'PAID', utr: 'UTR123456' });
    expect(db.referral.update.mock.calls[0][0].data.status).toBe('PAID');
    await expect(svc.markPaid('y1', { utr: 'x', paidOn: 'not a date' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('promoters', () => {
  it('a commission request needs the questionnaire, is created once, and tells the owner', async () => {
    await expect(svc.requestCommission({ ...PROMOTER, who: null, expect: null } as never)).rejects.toBeInstanceOf(ApiError);
    db.referralTask.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-21') });
    expect((await svc.requestCommission(PROMOTER)).requestedAt.toISOString()).toContain('2026-10-21');
    expect(db.referralTask.create).not.toHaveBeenCalled();
    db.referralTask.findFirst.mockResolvedValue(null);
    await svc.requestCommission(PROMOTER);
    expect(db.referralTask.create.mock.calls[0][0].data).toMatchObject({ kind: 'COMMISSION', promoterId: 'p1' });
  });

  it('setting the rate stores a definite cap (0 = none, omitted = the platform default), closes the request and emails', async () => {
    db.promoter.update.mockResolvedValue({ ...PROMOTER, commissionPct: 10 });
    await svc.setCommission('p1', { pct: 10, note: 'Good network.' });
    expect(db.promoter.update.mock.calls[0][0].data).toMatchObject({ commissionPct: 10, commissionCapMinor: 50_000_00 });
    await svc.setCommission('p1', { pct: 10, capMinor: 0 });
    expect(db.promoter.update.mock.calls[1][0].data.commissionCapMinor).toBe(0);
    await svc.setCommission('p1', { pct: 10, capMinor: 50_000_00, note: 'Good network.' });
    expect(db.promoter.update.mock.calls[2][0].data).toMatchObject({ commissionPct: 10, commissionCapMinor: 50_000_00 });
    expect(db.referralTask.updateMany.mock.calls[0][0].where).toMatchObject({ promoterId: 'p1', kind: 'COMMISSION', status: 'OPEN' });
    await new Promise((r) => setImmediate(r));
    expect(sendLetter).toHaveBeenCalledWith('rahul@example.com', null, expect.stringContaining('10%'), expect.anything(), 'REFERRAL');
  });

  it('suspending bumps tokenVersion so earlier tokens die; restoring does not', async () => {
    db.promoter.update.mockResolvedValue(PROMOTER);
    await svc.setPromoterStatus('p1', { status: 'SUSPENDED', reason: 'Complaints.' });
    expect(db.promoter.update.mock.calls[0][0].data).toMatchObject({ status: 'SUSPENDED', statusReason: 'Complaints.', tokenVersion: { increment: 1 } });
    await svc.setPromoterStatus('p1', { status: 'ACTIVE' });
    expect(db.promoter.update.mock.calls[1][0].data.tokenVersion).toBeUndefined();
    expect(db.promoter.update.mock.calls[1][0].data.statusReason).toBeNull();
  });

  it('a paused promoter cannot save payout details or post notes', async () => {
    const paused = { ...PROMOTER, status: 'SUSPENDED', statusReason: 'Paused.' } as never;
    await expect(svc.savePayoutDetails(paused, { payeeName: 'R', pan: 'ABCPM1234K', upi: 'r@upi' })).rejects.toMatchObject({ response: { code: 'PROMOTER_SUSPENDED' } });
    await expect(svc.addPromoterNote(paused, 'r1', 'hi')).rejects.toMatchObject({ response: { code: 'PROMOTER_SUSPENDED' } });
  });

  it('payout details need a UPI id or a bank account with IFSC, and open a KYC task once', async () => {
    await expect(svc.savePayoutDetails(PROMOTER, { payeeName: 'R', pan: 'ABCPM1234K' })).rejects.toBeInstanceOf(ApiError);
    db.promoter.update.mockResolvedValue(PROMOTER);
    await svc.savePayoutDetails(PROMOTER, { payeeName: 'R', pan: 'ABCPM1234K', upi: 'r@upi' });
    expect(db.promoter.update.mock.calls[0][0].data).toMatchObject({ pan: 'ABCPM1234K', upi: 'r@upi', kycVerifiedAt: null });
    expect(db.referralTask.create.mock.calls[0][0].data).toMatchObject({ kind: 'KYC' });
  });

  it('me() never returns the raw PAN or account number', async () => {
    db.referral.findMany.mockResolvedValue([]);
    db.referralPayout.findMany.mockResolvedValue([]);
    const me = await svc.me({ ...PROMOTER, pan: 'ABCPM1234K', bankAccount: '50100123456789' } as never);
    expect(JSON.stringify(me)).not.toContain('ABCPM1234K');
    expect(JSON.stringify(me)).not.toContain('50100123456789');
    expect(me.panMasked).toBe('AB•••••4K');
    expect(me.bankAccountMasked).toBe('••••6789');
  });

  it('addPromoter refuses a clash on email or number and sends the login email', async () => {
    db.promoter.findFirst.mockResolvedValue({ name: 'Rahul Mehta', email: 'rahul@example.com' });
    await expect(svc.addPromoter({ name: 'R', email: 'Rahul@Example.com' })).rejects.toBeInstanceOf(ApiError);
    db.promoter.findFirst.mockResolvedValue(null);
    db.promoter.findUnique.mockResolvedValue(null);
    db.promoter.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'p9', ...data }));
    const p = await svc.addPromoter({ name: 'Neha Gupta', phone: '98765 43210' });
    expect(p.phoneE164).toBe('+919876543210');
    await expect(svc.addPromoter({ name: 'No Door' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('attributeLead', () => {
  it('a quote from ?ref=CODE becomes an ACCEPTED referral for an active promoter, once', async () => {
    db.promoter.findUnique.mockResolvedValue(PROMOTER);
    db.referral.findFirst.mockResolvedValue(null);
    await svc.attributeLead('rahul42', { id: 'lead-9', name: 'Mr Rao', phone: '9822233445', email: null, school: 'Beacon Public School', interest: 'Pro' });
    expect(db.referral.create.mock.calls[0][0].data).toMatchObject({ promoterId: 'p1', leadId: 'lead-9', status: 'ACCEPTED', viaLink: true, consent: true });
    db.referral.findFirst.mockResolvedValue({ id: 'r-held' });
    await svc.attributeLead('rahul42', { id: 'lead-10', name: null, phone: '9822233445', email: null, school: 'Beacon Public School', interest: null });
    expect(db.referral.create).toHaveBeenCalledTimes(1);
  });
  it('an unknown or suspended code, or a lead with no school name, does nothing', async () => {
    db.promoter.findUnique.mockResolvedValue(null);
    await svc.attributeLead('NOPE', { id: 'l', name: null, phone: '9', email: null, school: 'X', interest: null });
    db.promoter.findUnique.mockResolvedValue({ ...PROMOTER, status: 'SUSPENDED' });
    await svc.attributeLead('RAHUL42', { id: 'l', name: null, phone: '9', email: null, school: 'X', interest: null });
    db.promoter.findUnique.mockResolvedValue(PROMOTER);
    await svc.attributeLead('RAHUL42', { id: 'l', name: null, phone: '9', email: null, school: null, interest: null });
    expect(db.referral.create).not.toHaveBeenCalled();
  });
});

describe('e164', () => {
  it('reads Indian numbers in every common shape and refuses the rest', () => {
    expect(e164('98765 43210')).toBe('+919876543210');
    expect(e164('09876543210')).toBe('+919876543210');
    expect(e164('+91 98765-43210')).toBe('+919876543210');
    expect(e164('919876543210')).toBe('+919876543210');
    expect(e164('+44 7700 900123')).toBe('+447700900123');
    expect(e164('12345')).toBeNull();
  });
});
