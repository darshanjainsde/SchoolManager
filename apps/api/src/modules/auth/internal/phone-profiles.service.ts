import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import type { UserRole } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

/**
 * WHO IS BEHIND A PHONE NUMBER. The one answer login, the chooser and
 * "switch profile" all read from — recomputed every time, never stored.
 *
 * A number reaches a login four ways (design §2): a verified `User.phone`
 * (admin / teacher / staff proved it), or the office-typed E.164 on a
 * Student (its family login), a Teacher or a Staff record. Suspended schools
 * and inactive logins never appear. Two logins are "the same person" exactly
 * when they share one of these numbers now — change the number at the office
 * and the link is gone the same second.
 */
export type ProfileKind = 'ADMIN' | 'TEACHER' | 'STAFF' | 'FAMILY';

export interface PhoneProfile {
  userId: string;
  schoolId: string;
  schoolName: string;
  /** The host the client must talk to for this profile: primary LIVE domain, else <slug>.<platform>. */
  host: string;
  role: UserRole;
  kind: ProfileKind;
  /** "Ravi Sharma" / "Priya Nair" / the admin's name or email local part. */
  label: string;
  /** "Class 5-B" / "Teacher" / "Staff" / "Admin". */
  sub: string;
}

type SchoolBits = { id: string; name: string; slug: string; status: string; domains: { hostname: string }[] };
const SCHOOL_SELECT = { id: true, name: true, slug: true, status: true, domains: { where: { isPrimary: true, status: 'LIVE' as const }, select: { hostname: true }, take: 1 } };

@Injectable()
export class PhoneProfilesService {
  private readonly env = loadEnv();

  private hostFor(s: SchoolBits): string {
    return s.domains[0]?.hostname ?? `${s.slug}.${this.env.PLATFORM_HOST}`;
  }

  /**
   * Every profile a phone can open. `schoolId` narrows to one school (a
   * request on a school host); `forLogin` drops admins — the console is
   * opened with a password, never a code (design §1 row 6).
   */
  async resolve(phone: string, opts: { schoolId?: string | null; forLogin?: boolean } = {}): Promise<PhoneProfile[]> {
    const db = getPlatformPrisma();
    const scope = opts.schoolId ? { schoolId: opts.schoolId } : {};
    const [verified, students, teachers, staff] = await Promise.all([
      db.user.findMany({
        where: { ...scope, phone, phoneVerifiedAt: { not: null }, isActive: true, schoolId: { not: null } },
        select: { id: true, role: true, name: true, email: true, schoolId: true, school: { select: SCHOOL_SELECT } },
      }),
      db.student.findMany({
        where: { ...scope, guardianPhoneE164: phone, isActive: true, userId: { not: null } },
        select: { userId: true, firstName: true, lastName: true, schoolId: true, classSection: { select: { name: true, grade: { select: { name: true } } } }, school: { select: SCHOOL_SELECT } },
      }),
      db.teacher.findMany({
        where: { ...scope, phoneE164: phone, isActive: true, userId: { not: null } },
        select: { userId: true, firstName: true, lastName: true, schoolId: true, school: { select: SCHOOL_SELECT } },
      }),
      db.staff.findMany({
        where: { ...scope, phoneE164: phone, isActive: true, userId: { not: null } },
        select: { userId: true, firstName: true, lastName: true, role: true, schoolId: true, school: { select: SCHOOL_SELECT } },
      }),
    ]);

    // The record rows name a userId; confirm each login is still open and learn its role.
    const recordUserIds = [...new Set([...students, ...teachers, ...staff].map((r) => r.userId!).filter(Boolean))];
    const recordUsers = recordUserIds.length
      ? await db.user.findMany({ where: { id: { in: recordUserIds }, isActive: true }, select: { id: true, role: true, name: true, email: true } })
      : [];
    const userById = new Map(recordUsers.map((u) => [u.id, u]));

    const out = new Map<string, PhoneProfile>();
    const put = (p: PhoneProfile) => { if (!out.has(p.userId)) out.set(p.userId, p); };
    const live = (s: SchoolBits) => s.status !== 'SUSPENDED';

    // Person records first: they carry the better label (a name and a class).
    for (const s of students) {
      const u = userById.get(s.userId!); if (!u || !live(s.school as SchoolBits)) continue;
      const cls = s.classSection ? `${s.classSection.grade.name}-${s.classSection.name}` : null;
      put({ userId: u.id, schoolId: s.schoolId, schoolName: s.school.name, host: this.hostFor(s.school as SchoolBits), role: u.role, kind: 'FAMILY', label: `${s.firstName} ${s.lastName}`.trim(), sub: cls ? `Class ${cls}` : 'Student' });
    }
    for (const t of teachers) {
      const u = userById.get(t.userId!); if (!u || !live(t.school as SchoolBits)) continue;
      put({ userId: u.id, schoolId: t.schoolId, schoolName: t.school.name, host: this.hostFor(t.school as SchoolBits), role: u.role, kind: u.role === 'SCHOOL_ADMIN' ? 'ADMIN' : 'TEACHER', label: `${t.firstName} ${t.lastName}`.trim(), sub: u.role === 'SCHOOL_ADMIN' ? 'Admin' : 'Teacher' });
    }
    for (const m of staff) {
      const u = userById.get(m.userId!); if (!u || !live(m.school as SchoolBits)) continue;
      put({ userId: u.id, schoolId: m.schoolId, schoolName: m.school.name, host: this.hostFor(m.school as SchoolBits), role: u.role, kind: u.role === 'SCHOOL_ADMIN' ? 'ADMIN' : 'STAFF', label: `${m.firstName} ${m.lastName}`.trim(), sub: u.role === 'SCHOOL_ADMIN' ? 'Admin' : m.role || 'Staff' });
    }
    for (const u of verified) {
      if (!u.school || !live(u.school as SchoolBits)) continue;
      const kind: ProfileKind = u.role === 'SCHOOL_ADMIN' ? 'ADMIN' : u.role === 'TEACHER' ? 'TEACHER' : u.role === 'STAFF' ? 'STAFF' : 'FAMILY';
      put({ userId: u.id, schoolId: u.schoolId!, schoolName: u.school.name, host: this.hostFor(u.school as SchoolBits), role: u.role, kind, label: u.name?.trim() || u.email.split('@')[0], sub: kind === 'ADMIN' ? 'Admin' : kind === 'TEACHER' ? 'Teacher' : kind === 'STAFF' ? 'Staff' : 'Student' });
    }

    let list = [...out.values()];
    if (opts.forLogin) list = list.filter((p) => p.kind !== 'ADMIN');
    // Families first (the common case on a shared phone), then by school, then by name.
    const rank: Record<ProfileKind, number> = { FAMILY: 0, TEACHER: 1, STAFF: 2, ADMIN: 3 };
    return list.sort((a, b) => rank[a.kind] - rank[b.kind] || a.schoolName.localeCompare(b.schoolName) || a.label.localeCompare(b.label));
  }

  /** The E.164 numbers a login owns right now — its phone identity. */
  async identityOf(userId: string): Promise<string[]> {
    const db = getPlatformPrisma();
    const [u, s, t, m] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } }),
      db.student.findFirst({ where: { userId }, select: { guardianPhoneE164: true } }),
      db.teacher.findFirst({ where: { userId }, select: { phoneE164: true } }),
      db.staff.findFirst({ where: { userId }, select: { phoneE164: true } }),
    ]);
    const set = new Set<string>();
    if (u?.phone && u.phoneVerifiedAt) set.add(u.phone);
    if (s?.guardianPhoneE164) set.add(s.guardianPhoneE164);
    if (t?.phoneE164) set.add(t.phoneE164);
    if (m?.phoneE164) set.add(m.phoneE164);
    return [...set];
  }

  /**
   * Everything this login may switch to (design §4 `/auth/switch`): every
   * profile behind any of its numbers, minus admin consoles — a console is
   * entered with a password, so a household phone that a family member
   * logged in with can never become the principal's console.
   */
  async switchable(userId: string): Promise<PhoneProfile[]> {
    const phones = await this.identityOf(userId);
    const lists = await Promise.all(phones.map((p) => this.resolve(p)));
    const out = new Map<string, PhoneProfile>();
    for (const list of lists) for (const p of list) if (p.kind !== 'ADMIN' && !out.has(p.userId)) out.set(p.userId, p);
    return [...out.values()];
  }
}
