const db = {
  user: { findMany: jest.fn(), findUnique: jest.fn() },
  student: { findMany: jest.fn(), findFirst: jest.fn() },
  teacher: { findMany: jest.fn(), findFirst: jest.fn() },
  staff: { findMany: jest.fn(), findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({ PLATFORM_HOST: 'sckools.com' }) }));

import { PhoneProfilesService } from './phone-profiles.service';

const PHONE = '+919876543210';
const raffles = { id: 's-raf', name: 'Raffles Public School', slug: 'raffles', status: 'LIVE', domains: [{ hostname: 'raffles.sckools.com' }] };
const beacon = { id: 's-bea', name: 'Beacon High', slug: 'beacon', status: 'LIVE', domains: [] };
const suspended = { ...beacon, id: 's-sus', slug: 'gone', status: 'SUSPENDED' };
const student = (userId: string, first: string, school = raffles, cls: { name: string; grade: { name: string } } | null = { name: 'B', grade: { name: '5' } }) => ({ userId, firstName: first, lastName: 'Sharma', schoolId: school.id, classSection: cls, school });
const teacher = (userId: string, first: string, school = raffles) => ({ userId, firstName: first, lastName: 'Nair', schoolId: school.id, school });
const user = (id: string, role: string, extra: Record<string, unknown> = {}) => ({ id, role, name: null, email: `${id}@raffles.test`, ...extra });

describe('PhoneProfilesService.resolve — who is behind a number', () => {
  const svc = () => new PhoneProfilesService();
  beforeEach(() => {
    jest.clearAllMocks();
    for (const t of [db.user, db.student, db.teacher, db.staff]) t.findMany.mockResolvedValue([]);
  });

  it('one number → one child: one family profile, host from the primary domain, class in the sub-line', async () => {
    db.student.findMany.mockResolvedValue([student('u-ravi', 'Ravi')]);
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([user('u-ravi', 'STUDENT')]);
    const r = await svc().resolve(PHONE, { forLogin: true });
    expect(r).toEqual([{ userId: 'u-ravi', schoolId: 's-raf', schoolName: 'Raffles Public School', host: 'raffles.sckools.com', role: 'STUDENT', kind: 'FAMILY', label: 'Ravi Sharma', sub: 'Class 5-B' }]);
  });

  it('one number → two children, same school: both, families first, sorted by name', async () => {
    db.student.findMany.mockResolvedValue([student('u-meera', 'Meera', raffles, { name: 'A', grade: { name: '8' } }), student('u-ravi', 'Ravi')]);
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([user('u-ravi', 'STUDENT'), user('u-meera', 'STUDENT')]);
    const r = await svc().resolve(PHONE);
    expect(r.map((p) => p.label)).toEqual(['Meera Sharma', 'Ravi Sharma']);
  });

  it('one number → teacher + parent at the same school: both profiles, the family one first', async () => {
    db.student.findMany.mockResolvedValue([student('u-ravi', 'Ravi')]);
    db.teacher.findMany.mockResolvedValue([teacher('u-priya', 'Priya')]);
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([user('u-ravi', 'STUDENT'), user('u-priya', 'TEACHER')]);
    const r = await svc().resolve(PHONE);
    expect(r.map((p) => [p.kind, p.label, p.sub])).toEqual([['FAMILY', 'Ravi Sharma', 'Class 5-B'], ['TEACHER', 'Priya Nair', 'Teacher']]);
  });

  it('children at two schools: both hosts from the app; a school host narrows to its own', async () => {
    db.student.findMany.mockResolvedValue([student('u-ravi', 'Ravi'), student('u-arjun', 'Arjun', beacon)]);
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([user('u-ravi', 'STUDENT'), user('u-arjun', 'STUDENT')]);
    const r = await svc().resolve(PHONE);
    expect(r.map((p) => p.host).sort()).toEqual(['beacon.sckools.com', 'raffles.sckools.com']);
    await svc().resolve(PHONE, { schoolId: 's-raf' });
    expect(db.student.findMany.mock.calls[1][0].where).toMatchObject({ schoolId: 's-raf', guardianPhoneE164: PHONE });
  });

  it('an admin who verified the family phone: offered on switch, never on login', async () => {
    db.user.findMany.mockResolvedValueOnce([user('u-admin', 'SCHOOL_ADMIN', { name: 'Darshan Jain', schoolId: 's-raf', school: raffles })]).mockResolvedValueOnce([user('u-ravi', 'STUDENT')]);
    db.student.findMany.mockResolvedValue([student('u-ravi', 'Ravi')]);
    const all = await svc().resolve(PHONE);
    expect(all.map((p) => [p.kind, p.label])).toEqual([['FAMILY', 'Ravi Sharma'], ['ADMIN', 'Darshan Jain']]);
    db.user.findMany.mockResolvedValueOnce([user('u-admin', 'SCHOOL_ADMIN', { name: 'Darshan Jain', schoolId: 's-raf', school: raffles })]).mockResolvedValueOnce([user('u-ravi', 'STUDENT')]);
    const login = await svc().resolve(PHONE, { forLogin: true });
    expect(login.map((p) => p.kind)).toEqual(['FAMILY']);
  });

  it('a suspended school and a closed login both disappear; a child with no section is named without a class', async () => {
    db.student.findMany.mockResolvedValue([student('u-gone', 'Gone', suspended), student('u-closed', 'Closed'), student('u-new', 'New', raffles, null)]);
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([user('u-gone', 'STUDENT'), user('u-new', 'STUDENT')]); // u-closed is inactive → not returned
    const r = await svc().resolve(PHONE);
    expect(r).toEqual([expect.objectContaining({ userId: 'u-new', label: 'New Sharma', sub: 'Student' })]);
    expect(db.user.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['u-gone', 'u-closed', 'u-new'] }, isActive: true });
  });
});

describe('identityOf + switchable — the stateless link between profiles', () => {
  const svc = () => new PhoneProfilesService();
  beforeEach(() => { jest.clearAllMocks(); for (const t of [db.user, db.student, db.teacher, db.staff]) t.findMany.mockResolvedValue([]); });

  it('a login owns its verified phone and the E.164 of the record behind it; nothing else', async () => {
    db.user.findUnique.mockResolvedValue({ phone: '+919999999999', phoneVerifiedAt: new Date() });
    db.student.findFirst.mockResolvedValue(null);
    db.teacher.findFirst.mockResolvedValue({ phoneE164: PHONE });
    db.staff.findFirst.mockResolvedValue(null);
    expect((await svc().identityOf('u-priya')).sort()).toEqual([PHONE, '+919999999999']);
    db.user.findUnique.mockResolvedValue({ phone: '+919999999999', phoneVerifiedAt: null }); // pending, not proven
    db.teacher.findFirst.mockResolvedValue({ phoneE164: null });
    expect(await svc().identityOf('u-priya')).toEqual([]);
  });

  it('switchable = every profile behind those numbers, minus admin consoles', async () => {
    db.user.findUnique.mockResolvedValue({ phone: PHONE, phoneVerifiedAt: new Date() });
    db.student.findFirst.mockResolvedValue(null); db.teacher.findFirst.mockResolvedValue(null); db.staff.findFirst.mockResolvedValue(null);
    db.user.findMany.mockResolvedValueOnce([user('u-admin', 'SCHOOL_ADMIN', { name: 'Darshan Jain', schoolId: 's-raf', school: raffles })]).mockResolvedValueOnce([user('u-ravi', 'STUDENT')]);
    db.student.findMany.mockResolvedValue([student('u-ravi', 'Ravi')]);
    const r = await svc().switchable('u-admin');
    expect(r.map((p) => p.kind)).toEqual(['FAMILY']);
  });
});
