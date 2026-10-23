import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MarketingService, heroStatsOf, resolveDiscount } from './marketing.service';
import { CreateLeadActivityDto, CreateLeadDto, UpdateLeadDto, UpdateMarketingConfigDto } from './marketing.dto';
import type { MailService } from '../../common/mail/mail.service';

const prismaMock = {
  marketingConfig: {
    upsert: jest.fn().mockResolvedValue({
      id: 'default',
      priceBasicUsd: 19,
      priceBasicInr: 999,
      priceStdUsd: 49,
      priceStdInr: 2499,
      priceProUsd: 99,
      priceProInr: 4999,
      contactEmail: 'admin@sckools.com',
      contactPhone: '',
      loginOtpEnabled: false,
      heroStats: [],
      discountEnabled: false,
      discountPercent: 50,
      discountLabel: 'Launch offer',
      discountEndsAt: null,
      updatedAt: new Date(),
    }),
  },
  marketingLead: {
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'lead-1', status: 'NEW', createdAt: new Date(), ...data })),
    findMany: jest.fn().mockResolvedValue([]),
    // One shape serves both reads in updateLead: the pre-check (no include)
    // ignores `activities`, and the getLead re-read needs it present.
    findUnique: jest.fn().mockResolvedValue({
      id: 'lead-1',
      name: 'Sunita Rao',
      phone: '+91 98765 43210',
      email: null,
      school: null,
      interest: null,
      source: 'modal',
      status: 'NEW',
      nextFollowUpAt: null,
      lastContactedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      activities: [],
    }),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockImplementation((args) => Promise.resolve(args)),
  },
  leadActivity: {
    create: jest.fn().mockImplementation((args) => Promise.resolve(args)),
  },
  $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
};

// The service now reaches the referrals module (for ?ref attribution), whose
// index pulls in controllers that read enums off the real package at load.
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => prismaMock }));

function dto(input: Partial<CreateLeadDto>): CreateLeadDto {
  return plainToInstance(CreateLeadDto, { source: 'modal', phone: '+91 98765 43210', ...input });
}

describe('CreateLeadDto phone validation', () => {
  it('accepts an Indian mobile with country code', () => {
    expect(validateSync(dto({}))).toHaveLength(0);
  });
  it('accepts a bare 10-digit number', () => {
    expect(validateSync(dto({ phone: '9876543210' }))).toHaveLength(0);
  });
  it('rejects alphabetic garbage', () => {
    expect(validateSync(dto({ phone: 'call me maybe' })).length).toBeGreaterThan(0);
  });
  it('rejects too-short numbers', () => {
    expect(validateSync(dto({ phone: '12345' })).length).toBeGreaterThan(0);
  });
});

describe('MarketingService', () => {
  const mail = { sendLeadNotification: jest.fn().mockResolvedValue(true) } as unknown as MailService;
  const svc = new MarketingService(mail);

  beforeEach(() => jest.clearAllMocks());

  it('getPublicConfig maps the singleton row into tiered prices', async () => {
    const cfg = await svc.getPublicConfig();
    expect(cfg.prices.standard).toEqual({ usd: 49, inr: 2499 });
    expect(cfg.contactEmail).toBe('admin@sckools.com');
    // Upsert-on-read seeds the row when the table is empty.
    expect(prismaMock.marketingConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'default' } }),
    );
  });

  it('getPublicConfig reports an empty hero list and an off discount for an untouched row', async () => {
    const cfg = await svc.getPublicConfig();
    expect(cfg.heroStats).toEqual([]);
    expect(cfg.discount).toEqual({ enabled: false, percent: 50, label: 'Launch offer', endsAt: null });
  });

  it('updateConfig stores hero stats trimmed and the end date as a Date, and null clears it', async () => {
    await svc.updateConfig({
      ...baseConfig(),
      heroStats: [{ n: 13, label: ' modules, one login ' }],
      discountEnabled: true,
      discountPercent: 50,
      discountEndsAt: '2026-11-30T18:30:00.000Z',
    });
    const data = prismaMock.marketingConfig.upsert.mock.calls.at(-1)[0].update;
    expect(data.heroStats).toEqual([{ n: 13, label: 'modules, one login' }]);
    expect(data.discountEndsAt).toEqual(new Date('2026-11-30T18:30:00.000Z'));
    expect(data.discountEnabled).toBe(true);

    await svc.updateConfig({ ...baseConfig(), discountEndsAt: null });
    expect(prismaMock.marketingConfig.upsert.mock.calls.at(-1)[0].update.discountEndsAt).toBeNull();

    // A console that does not send the new fields leaves them alone.
    await svc.updateConfig(baseConfig());
    const untouched = prismaMock.marketingConfig.upsert.mock.calls.at(-1)[0].update;
    expect('heroStats' in untouched).toBe(false);
    expect('discountEndsAt' in untouched).toBe(false);
  });

  it('createLead trims fields, stores the row and fires notification email', async () => {
    const res = await svc.createLead(dto({ name: '  Sunita Rao  ', school: '', interest: 'Pro' }));
    expect(res).toEqual({ ok: true });
    const stored = prismaMock.marketingLead.create.mock.calls[0][0].data;
    expect(stored.name).toBe('Sunita Rao');
    expect(stored.school).toBeNull(); // empty string → null
    expect(mail.sendLeadNotification).toHaveBeenCalledWith('admin@sckools.com', expect.objectContaining({ interest: 'Pro' }));
  });
});

describe('MarketingService — lead pipeline', () => {
  const mail = { sendLeadNotification: jest.fn().mockResolvedValue(true) } as unknown as MailService;
  const svc = new MarketingService(mail);

  beforeEach(() => jest.clearAllMocks());

  it('records a STAGE_CHANGE activity when the stage actually moves', async () => {
    await svc.updateLead('lead-1', { status: 'QUALIFIED' } as UpdateLeadDto, 'owner-1');

    expect(prismaMock.leadActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.leadActivity.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        leadId: 'lead-1',
        kind: 'STAGE_CHANGE',
        fromStatus: 'NEW',
        toStatus: 'QUALIFIED',
        actorId: 'owner-1',
      }),
    );
  });

  it('does not log a stage change when the stage is re-selected unchanged', async () => {
    // The mocked lead is already NEW, so this PATCH is a no-op move.
    await svc.updateLead('lead-1', { status: 'NEW' } as UpdateLeadDto, 'owner-1');
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it('only writes the fields the PATCH actually carried', async () => {
    await svc.updateLead('lead-1', { nextFollowUpAt: '2026-09-20T09:00:00.000Z' } as UpdateLeadDto);
    const data = prismaMock.marketingLead.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['nextFollowUpAt']);
    expect(data.nextFollowUpAt).toEqual(new Date('2026-09-20T09:00:00.000Z'));
  });

  it('treats an explicit null follow-up as "clear it"', async () => {
    await svc.updateLead('lead-1', { nextFollowUpAt: null } as UpdateLeadDto);
    expect(prismaMock.marketingLead.update.mock.calls[0][0].data.nextFollowUpAt).toBeNull();
  });

  it('stamps lastContactedAt for contact activities but not for a note', async () => {
    await svc.addLeadActivity('lead-1', { kind: 'CALL', body: 'Rang, no answer' } as CreateLeadActivityDto);
    expect(prismaMock.marketingLead.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketingLead.update.mock.calls[0][0].data.lastContactedAt).toBeInstanceOf(Date);

    jest.clearAllMocks();

    await svc.addLeadActivity('lead-1', { kind: 'NOTE', body: 'Budget approved' } as CreateLeadActivityDto);
    expect(prismaMock.leadActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketingLead.update).not.toHaveBeenCalled();
  });

  it('searches name, phone, school, interest and email from one term', async () => {
    await svc.listLeads(undefined, '  rao  ');
    const where = prismaMock.marketingLead.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(5);
    // Trimmed, and case-insensitive so "rao" finds "Rao".
    expect(where.OR[0]).toEqual({ name: { contains: 'rao', mode: 'insensitive' } });
  });

  it('throws NotFound rather than silently creating when the lead is gone', async () => {
    prismaMock.marketingLead.findUnique.mockResolvedValueOnce(null);
    await expect(svc.updateLead('missing', { status: 'WON' } as UpdateLeadDto)).rejects.toThrow('not found');
  });
});

function baseConfig(): UpdateMarketingConfigDto {
  return {
    priceBasicUsd: 1, priceBasicInr: 30, priceStdUsd: 2, priceStdInr: 45, priceProUsd: 3, priceProInr: 60,
    contactEmail: 'admin@sckools.com', contactPhone: '',
  };
}

describe('resolveDiscount — the clock decides, not only the switch', () => {
  const row = (over: Partial<Parameters<typeof resolveDiscount>[0]>) => ({
    discountEnabled: true, discountPercent: 50, discountLabel: 'Launch offer', discountEndsAt: null as Date | null, ...over,
  });
  const now = new Date('2026-10-22T10:00:00.000Z');

  it('is on with no end date while the switch is on', () => {
    expect(resolveDiscount(row({}), now).enabled).toBe(true);
  });
  it('is on until the end date, then off at and after it', () => {
    expect(resolveDiscount(row({ discountEndsAt: new Date('2026-10-22T10:00:01.000Z') }), now).enabled).toBe(true);
    expect(resolveDiscount(row({ discountEndsAt: now }), now).enabled).toBe(false);
    expect(resolveDiscount(row({ discountEndsAt: new Date('2026-10-01T00:00:00.000Z') }), now).enabled).toBe(false);
  });
  it('is off when the switch is off, whatever the date', () => {
    expect(resolveDiscount(row({ discountEnabled: false, discountEndsAt: new Date('2027-01-01T00:00:00.000Z') }), now).enabled).toBe(false);
  });
  it('serialises the end date as an ISO instant for the site countdown', () => {
    expect(resolveDiscount(row({ discountEndsAt: new Date('2026-11-30T18:30:00.000Z') }), now).endsAt).toBe('2026-11-30T18:30:00.000Z');
  });
});

describe('heroStatsOf — the JSON column read defensively', () => {
  it('keeps well-formed entries, drops junk, caps at four, rounds numbers', () => {
    expect(heroStatsOf([{ n: 13.4, label: 'modules' }, { label: 'no number' }, 'x', null, { n: 1, label: 'a' }, { n: 2, label: 'b' }, { n: 3, label: 'c' }, { n: 4, label: 'd' }]))
      .toEqual([{ n: 13, label: 'modules' }, { n: 1, label: 'a' }, { n: 2, label: 'b' }, { n: 3, label: 'c' }]);
  });
  it('returns an empty list for anything that is not an array', () => {
    expect(heroStatsOf(null)).toEqual([]);
    expect(heroStatsOf({})).toEqual([]);
  });
});
