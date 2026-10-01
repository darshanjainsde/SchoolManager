// The owner's delete must go through the backup gate, and every status change
// must be time-stamped — the gate compares a backup's time with that stamp.
const db = {
  school: { update: jest.fn(), findUnique: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));

import { OwnerSchoolsService } from './owner-schools.service';

const ID = '834652cc-876d-417a-b3cf-498b46d2320f';
const backups = { deleteSchoolNow: jest.fn() };
const make = () =>
  new (OwnerSchoolsService as unknown as new (...a: unknown[]) => OwnerSchoolsService)({ invalidate: jest.fn() }, {}, backups);

beforeEach(() => jest.clearAllMocks());

describe('deleting a school from the owner console', () => {
  it('is the backup-gated delete — never a bare row delete', async () => {
    backups.deleteSchoolNow.mockResolvedValue({ ok: true, files: 3, backupId: 'b-1' });
    await expect(make().deleteSchool(ID)).resolves.toEqual({ ok: true, files: 3, backupId: 'b-1' });
    expect(backups.deleteSchoolNow).toHaveBeenCalledWith(ID);
  });

  it('passes the gate’s refusal through unchanged (no backup → no delete)', async () => {
    backups.deleteSchoolNow.mockRejectedValue(Object.assign(new Error('Take a backup of the school first'), { status: 409 }));
    await expect(make().deleteSchool(ID)).rejects.toThrow(/Take a backup/);
  });
});

describe('changing a school’s status', () => {
  it('records WHEN it changed, so a backup can be proven to come after a suspension', async () => {
    db.school.update.mockResolvedValue({});
    db.school.findUnique.mockResolvedValue({ id: ID, name: 'X', slug: 'x', tier: 'PRO', status: 'SUSPENDED', domains: [], featureOverrides: [] });
    const t0 = Date.now();
    await make().setStatus(ID, 'SUSPENDED');
    const data = db.school.update.mock.calls[0][0].data;
    expect(data.status).toBe('SUSPENDED');
    expect(data.statusChangedAt).toBeInstanceOf(Date);
    expect(data.statusChangedAt.getTime()).toBeGreaterThanOrEqual(t0);
  });
});
