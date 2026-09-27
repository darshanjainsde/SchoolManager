import { Prisma } from '@skoolos/db';
import { SECRET_FIELDS, buildSnapshot, redact, tenantModels } from './school-snapshot';

describe('the school snapshot — every tenant table, no secrets', () => {
  it('derives the table list from the schema, so a new table is covered without anyone remembering', () => {
    const names = tenantModels().map((p) => p.model);
    expect(names).toEqual(expect.arrayContaining(['Student', 'Teacher', 'ClassSection', 'FeeInvoice', 'Attendance', 'SchoolProfile']));
    // Every model with a schoolId is in it, bar the secret ones.
    const all = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'schoolId')).map((m) => m.name);
    for (const m of all) if (!['OtpChallenge', 'RefreshToken', 'Session', 'PasswordReset', 'OwnerSession'].includes(m)) expect(names).toContain(m);
    expect(names).not.toContain('OtpChallenge');
  });
  it('the User table is included but its password hash is not', () => {
    expect(tenantModels().map((p) => p.model)).toContain('User');
    expect(redact({ id: 'u1', email: 'a@b.c', passwordHash: '$argon2…', role: 'TEACHER' })).toEqual({ id: 'u1', email: 'a@b.c', passwordHash: '[redacted]', role: 'TEACHER' });
    expect(SECRET_FIELDS.has('passwordHash')).toBe(true);
  });
  it('pages through a big table and stitches the rows', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `s${String(i).padStart(5, '0')}`, schoolId: 'x', firstName: 'A' }));
    const db: Record<string, unknown> = {
      school: { findUnique: jest.fn().mockResolvedValue({ id: 'x', name: 'S', passwordHash: null }) },
    };
    for (const { model } of tenantModels()) {
      const key = model.charAt(0).toLowerCase() + model.slice(1);
      db[key] = {
        findMany: jest.fn(async (a: { take: number; cursor?: { id: string } }) => {
          if (model !== 'Student') return [];
          const start = a.cursor ? rows.findIndex((r) => r.id === a.cursor!.id) + 1 : 0;
          return rows.slice(start, start + a.take);
        }),
      };
    }
    const snap = await buildSnapshot(db as never, 'x', 1000);
    expect(snap.tables.Student).toHaveLength(2500);
    expect((db.student as { findMany: jest.Mock }).findMany).toHaveBeenCalledTimes(3);
    expect(snap.meta.rows).toBe(2500);
  });
});
