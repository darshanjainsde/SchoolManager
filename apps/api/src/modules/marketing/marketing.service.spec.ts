import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MarketingService } from './marketing.service';
import { CreateLeadActivityDto, CreateLeadDto, UpdateLeadDto } from './marketing.dto';
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

jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => prismaMock }));

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
