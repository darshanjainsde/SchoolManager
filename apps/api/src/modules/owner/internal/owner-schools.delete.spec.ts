// Deleting a school must take EVERYTHING with it: every row, every file it
// ever stored, and the cached address. Each case here is a way the old delete
// left something behind or refused to run.
const calls: string[] = [];
const op = (name: string) => jest.fn((arg?: unknown) => { calls.push(name); return { name, arg }; });
const db = {
  school: { findUnique: jest.fn(), delete: op('school.delete') },
  feeInvoice: { deleteMany: op('feeInvoice.deleteMany') },
  feePlanItem: { deleteMany: op('feePlanItem.deleteMany') },
  eventRegistration: { deleteMany: op('eventRegistration.deleteMany') },
  exam: { deleteMany: op('exam.deleteMany') },
  otpChallenge: { deleteMany: op('otpChallenge.deleteMany') },
  $transaction: jest.fn(async (ops: unknown[]) => { calls.push('COMMIT'); return ops; }),
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('@skoolos/config', () => ({ ...jest.requireActual('@skoolos/config'), loadEnv: () => ({ PLATFORM_HOST: 'test.sckools.com' }) }));

import { ConflictException } from '@nestjs/common';
import { OwnerSchoolsService } from './owner-schools.service';

const ID = '834652cc-876d-417a-b3cf-498b46d2320f';
const storage = {
  delete: jest.fn(async (k: string) => { calls.push(`delete ${k}`); }),
  deletePrefix: jest.fn(async (p: string) => { calls.push(`deletePrefix ${p}`); return 3; }),
};
const featureResolver = { invalidate: jest.fn(async () => { calls.push('features.invalidate'); }) };
const lookup = { invalidate: jest.fn(async (h: string) => { calls.push(`lookup.invalidate ${h}`); }) };
const make = () =>
  new (OwnerSchoolsService as unknown as new (...a: unknown[]) => OwnerSchoolsService)(featureResolver, {}, storage, lookup);

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  db.school.findUnique.mockResolvedValue({
    id: ID, slug: 'snsps', status: 'SUSPENDED',
    media: [{ storageKey: `schools/${ID}/logo/a.png` }, { storageKey: 'legacy/elsewhere.png' }],
    domains: [{ hostname: 'Snsps.Demo.Sckools.com' }],
  });
});

describe('deleting a school removes everything it owns', () => {
  it('refuses a school that is not suspended, and touches nothing', async () => {
    db.school.findUnique.mockResolvedValue({ id: ID, slug: 'snsps', status: 'LIVE', media: [], domains: [] });
    await expect(make().deleteSchool(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(calls).toEqual([]);
  });

  it('clears the rows that would BLOCK the cascade, and the rows it cannot reach, before the school — in one transaction', async () => {
    await make().deleteSchool(ID);
    const tx = calls.slice(0, calls.indexOf('COMMIT'));
    expect(tx).toEqual([
      'feeInvoice.deleteMany', 'feePlanItem.deleteMany', 'eventRegistration.deleteMany',
      'exam.deleteMany', 'otpChallenge.deleteMany', 'school.delete',
    ]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('deletes files only AFTER the database commit — a failed delete must not leave a live school with broken images', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('FK violation'));
    await expect(make().deleteSchool(ID)).rejects.toThrow('FK violation');
    expect(storage.deletePrefix).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('empties the school’s whole folder in storage, not just the files that had a MediaAsset row', async () => {
    const out = await make().deleteSchool(ID);
    expect(storage.deletePrefix.mock.calls.map((c) => c[0])).toEqual([`schools/${ID}/`, `print-orders/${ID}/`]);
    // A key outside the folder is still deleted by name; one inside is not deleted twice.
    expect(storage.delete.mock.calls.map((c) => c[0])).toEqual(['legacy/elsewhere.png']);
    expect(out).toEqual({ ok: true, files: 6 });
  });

  it('stops the address resolving now, not when the cache entry expires', async () => {
    await make().deleteSchool(ID);
    expect(lookup.invalidate.mock.calls.map((c) => c[0])).toEqual(['snsps.test.sckools.com', 'snsps.demo.sckools.com']);
    expect(featureResolver.invalidate).toHaveBeenCalledWith(ID);
  });
});
