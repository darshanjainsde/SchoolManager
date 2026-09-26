const tx = {
  school: { create: jest.fn(), findFirst: jest.fn() },
  domain: { create: jest.fn() },
  user: { create: jest.fn() },
  schoolProfile: { create: jest.fn() },
  homepageContent: { create: jest.fn() },
  grade: { createMany: jest.fn() },
  course: { createMany: jest.fn() },
};
const db = {
  school: { findFirst: jest.fn() },
  $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => db,
}));

import { OwnerSchoolsService } from './owner-schools.service';

function make() {
  const passwords = { hash: jest.fn().mockResolvedValue('hash') };
  const featureResolver = { invalidate: jest.fn() };
  const storage = { delete: jest.fn() };
  // Constructor order read from the service: (featureResolver, passwords, storage).
  return new (OwnerSchoolsService as unknown as new (...a: unknown[]) => OwnerSchoolsService)(featureResolver, passwords, storage);
}

const dto = { name: 'Maple Leaf Academy', slug: 'maple-leaf', tier: 'STANDARD' as const, domainHostname: 'maple.test', adminEmail: 'Admin@Maple.test' };

beforeEach(() => {
  jest.clearAllMocks();
  db.school.findFirst.mockResolvedValue(null);
  tx.school.create.mockResolvedValue({ id: 'school-1', slug: 'maple-leaf' });
});

describe('creating a school writes its country and the defaults its pack carries', () => {
  it('a school created with no country is Indian, exactly as before', async () => {
    await make().create(dto as never);
    expect(tx.school.create.mock.calls[0][0].data).toMatchObject({
      countryCode: 'IN', timezone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR',
    });
  });
  it('a school created in another country keeps its code — and, until that country has a pack, India’s defaults', async () => {
    await make().create({ ...dto, countryCode: 'AE' } as never);
    expect(tx.school.create.mock.calls[0][0].data).toMatchObject({
      countryCode: 'AE', timezone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR',
    });
  });
  it('lower-case input is stored upper-case, the way the schema and the pack registry expect', async () => {
    await make().create({ ...dto, countryCode: 'ae' } as never);
    expect(tx.school.create.mock.calls[0][0].data.countryCode).toBe('AE');
  });
});
