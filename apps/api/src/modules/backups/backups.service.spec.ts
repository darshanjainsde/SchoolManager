// The job rules a reviewer found missing — each test is a way a good backup
// could be lost, or a school deleted without one. The engine is proven
// against real Postgres in test/school-backup.e2e-spec.ts; this pins the
// service's decisions with the database and storage faked.
type Row = Record<string, any>;
const backups = new Map<string, Row>();
const schools = new Map<string, Row>();
const match = (r: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => match(r, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return r[k] !== v.not;
      if ('lt' in v) return r[k] != null && r[k] < v.lt;
      if ('gte' in v) return r[k] != null && r[k] >= v.gte;
      return true;
    }
    return r[k] === v;
  });
const db = {
  schoolBackup: {
    findUnique: jest.fn(async ({ where }) => backups.get(where.id) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }) => backups.get(where.id)),
    findFirst: jest.fn(async ({ where }) => [...backups.values()].find((b) => match(b, where)) ?? null),
    findMany: jest.fn(async ({ where }) => [...backups.values()].filter((b) => match(b, where))),
    update: jest.fn(async ({ where, data }) => Object.assign(backups.get(where.id)!, data)),
    updateMany: jest.fn(async ({ where, data }) => {
      const hit = [...backups.values()].filter((b) => match(b, where));
      hit.forEach((b) => Object.assign(b, data));
      return { count: hit.length };
    }),
    count: jest.fn(async () => 0),
  },
  school: {
    findUnique: jest.fn(async ({ where }) => schools.get(where.id) ?? null),
  },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('./engine/purge', () => ({ purgeSchoolRows: jest.fn(async () => undefined), purgeSchoolFiles: jest.fn(async () => 4) }));

import { BackupsService } from './backups.service';
import { purgeSchoolFiles, purgeSchoolRows } from './engine/purge';

const SCHOOL = '834652cc-876d-417a-b3cf-498b46d2320f';
const lookup = { invalidate: jest.fn() };
const features = { invalidate: jest.fn() };
let svc: BackupsService;
let s3: { send: jest.Mock };

function backup(over: Row = {}): Row {
  const b = {
    id: 'b-1', sourceSchoolId: SCHOOL, schoolSlug: 'snsps', schoolName: 'SNSPS', reason: 'BEFORE_DELETE', status: 'READY',
    storageKey: `backups/schools/${SCHOOL}/snsps.sckools`, deleteSchoolAfter: true, error: null, state: null, manifest: null,
    sizeBytes: null, rowCount: 10, fileCount: 1, createdAt: new Date(), finishedAt: new Date(), expiresAt: new Date(Date.now() + 86400e3),
    lockedUntil: null, ...over,
  };
  backups.set(b.id, b);
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  backups.clear();
  schools.clear();
  process.env.SCHOOL_BACKUP_PASSWORD = 'unit-test-backup-password';
  svc = new BackupsService({} as never, lookup as never, features as never);
  s3 = { send: jest.fn(async () => ({})) };
  (svc as unknown as { s3: unknown }).s3 = s3;
});
afterAll(() => { delete process.env.SCHOOL_BACKUP_PASSWORD; });

describe('the delete after a final backup never costs the backup', () => {
  it('a delete that fails leaves the backup READY, says so, and stays queued for a retry', async () => {
    backup();
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: new Date(Date.now() - 3600e3), domains: [] });
    (purgeSchoolRows as jest.Mock).mockRejectedValueOnce(new Error('statement timeout'));
    await (svc as unknown as { finishPendingDelete: (id: string) => Promise<void> }).finishPendingDelete('b-1');
    const b = backups.get('b-1')!;
    expect(b.status).toBe('READY');
    expect(b.deleteSchoolAfter).toBe(true);
    expect(b.error).toMatch(/backup is safe.*statement timeout.*retried/i);
    expect((await svc.get('b-1')).deletePending).toBe(true);
  });

  it('a school taken off Suspended during the backup is NOT deleted, and the backup is kept', async () => {
    backup();
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'LIVE', statusChangedAt: new Date(), domains: [] });
    await (svc as unknown as { finishPendingDelete: (id: string) => Promise<void> }).finishPendingDelete('b-1');
    expect(purgeSchoolRows).not.toHaveBeenCalled();
    expect(backups.get('b-1')).toMatchObject({ status: 'READY', deleteSchoolAfter: false });
    expect(backups.get('b-1')!.error).toMatch(/taken off Suspended/);
  });

  it('when an earlier attempt removed the rows but was cut off, the retry finishes the files and clears the flag', async () => {
    backup({ error: 'The backup is safe. The delete did not finish …' });
    await (svc as unknown as { finishPendingDelete: (id: string) => Promise<void> }).finishPendingDelete('b-1');
    expect(purgeSchoolFiles).toHaveBeenCalledWith(expect.anything(), SCHOOL);
    expect(backups.get('b-1')).toMatchObject({ status: 'READY', deleteSchoolAfter: false, error: null });
  });
});

describe('the delete gate', () => {
  it('refuses when the backup row is READY but its file is gone from storage — and deletes nothing', async () => {
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: new Date(Date.now() - 3600e3), domains: [] });
    backup({ deleteSchoolAfter: false });
    s3.send.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
    await expect(svc.deleteSchoolNow(SCHOOL)).rejects.toMatchObject({ response: { code: 'BACKUP_REQUIRED' } });
    expect(purgeSchoolRows).not.toHaveBeenCalled();
  });

  it('keeps the backup a deleted school relies on for a year, whatever kind it was', async () => {
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: new Date(Date.now() - 3600e3), domains: [] });
    backup({ reason: 'MANUAL', deleteSchoolAfter: false, expiresAt: new Date(Date.now() + 2 * 86400e3) });
    await svc.deleteSchoolNow(SCHOOL);
    expect(backups.get('b-1')!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * 86400e3);
    expect(purgeSchoolRows).toHaveBeenCalled();
  });
});

describe('a running backup', () => {
  const running = (over: Row = {}) => backup({
    status: 'RUNNING', deleteSchoolAfter: true,
    state: { export: { table: 0, writer: null, phase: 'rows' }, sink: null, progress: 0, ...over },
  });

  it('a final backup waits for a just-suspended school to go quiet before reading a row', async () => {
    running();
    const suspendedAt = new Date(Date.now() - 10_000);
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: suspendedAt, domains: [] });
    const v = await svc.step('b-1');
    expect(v).toMatchObject({ status: 'RUNNING', waiting: true });
    // The job records WHEN it can go on — the end of the 70 s settle period — in
    // the lease column, so no worker re-polls it before then. (It used to release
    // the lease, which let every poll and every cron tick pick it up to find it
    // still waiting.)
    expect(backups.get('b-1')!.lockedUntil.getTime()).toBe(suspendedAt.getTime() + 70_000);
    expect(s3.send).not.toHaveBeenCalled(); // nothing written yet
  });

  it('a copy of what a reset is about to replace waits the same way', async () => {
    backup({
      reason: 'BEFORE_RESET', status: 'RUNNING', scope: 'day',
      state: { export: { table: 0, writer: null, phase: 'rows' }, sink: null, progress: 0 },
    });
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: new Date(Date.now() - 10_000), domains: [] });
    expect(await svc.step('b-1')).toMatchObject({ status: 'RUNNING', waiting: true });
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('is not leasable again until its wake-up time, so a second worker does nothing', async () => {
    running();
    schools.set(SCHOOL, { id: SCHOOL, slug: 'snsps', status: 'SUSPENDED', statusChangedAt: new Date(Date.now() - 10_000), domains: [] });
    await svc.step('b-1'); // waits, and records when
    const updates = (db.schoolBackup.update as jest.Mock).mock.calls.length;
    await svc.step('b-1'); // a second poll: the lease is held until then
    expect((db.schoolBackup.update as jest.Mock).mock.calls.length).toBe(updates);
  });

  it('stops after five steps in a row that were cut off, instead of retrying forever', async () => {
    running({ attempts: 5, sink: { bucket: 'b', key: 'k', uploadId: 'u', parts: [], uploaded: 0, spilled: 0 } });
    const v = await svc.step('b-1');
    expect(v.status).toBe('FAILED');
    expect(v.error).toMatch(/5 tries in a row.*Nothing was deleted/);
    expect(s3.send).toHaveBeenCalled(); // the unfinished upload is aborted
  });
});

describe('expiry', () => {
  it('never removes the file of a backup a pending delete still relies on', async () => {
    backup({ deleteSchoolAfter: true, expiresAt: new Date(Date.now() - 1) });
    await (svc as unknown as { expire: (id: string, key: string) => Promise<void> }).expire('b-1', 'k');
    expect(s3.send).not.toHaveBeenCalled();
    expect(backups.get('b-1')!.status).toBe('READY');
  });

  it('marks a backup EXPIRED before its file goes, so nothing can pick it up mid-removal', async () => {
    backup({ deleteSchoolAfter: false });
    const order: string[] = [];
    db.schoolBackup.updateMany.mockImplementationOnce(async ({ where, data }) => { order.push('marked'); const b = backups.get(where.id)!; Object.assign(b, data); return { count: 1 }; });
    s3.send.mockImplementationOnce(async () => { order.push('deleted'); return {}; });
    await (svc as unknown as { expire: (id: string, key: string) => Promise<void> }).expire('b-1', 'k');
    expect(order).toEqual(['marked', 'deleted']);
  });
});
