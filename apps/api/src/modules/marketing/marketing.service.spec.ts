import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MarketingService } from './marketing.service';
import { CreateLeadDto } from './marketing.dto';
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
    findUnique: jest.fn(),
    update: jest.fn(),
  },
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
