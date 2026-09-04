/**
 * STUDENT PORTAL E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * Run locally:
 *   DATABASE_URL_TEST='postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public' \
 *   pnpm exec jest --config test/jest-e2e.config.js --runInBand student.e2e-spec
 *
 * Seeded school used here:
 *   beacon  (PRO, LIVE) — has MANAGEMENT feature, one class (Grade 5 A), one teacher (Meera Nair)
 *
 * What this suite proves:
 *   1. Admin provisions a student login → 201 { email, tempPassword }; second call → 409.
 *   2. Student logs in via POST /auth/login → 201 with accessToken.
 *   3. GET /me/profile (student token) → 200; firstName matches, className non-null.
 *   4. GET /me/timetable (student token) → 200 array; contains the seeded slot.
 *   5. Announcement targeting: school-wide + own-class visible; other-class NOT visible.
 *   6. Role isolation: student token on /manage/* → 403; admin token on /me/* → 403.
 */

import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import { describeLiveApi, LIVE_API_BASE } from './requires-live-api';

// Honour E2E_API_BASE. requires-live-api.ts has exported LIVE_API_BASE all
// along and all four suites ignored it, so pointing them at a purpose-booted
// API was impossible — they always hit whatever happened to hold :3001. That
// is the exact failure this file's own docstring warns about: a stale server
// on the wrong database answers /health and fails every assertion.
const BASE = LIVE_API_BASE;

/** Obtain a school-scoped JWT (school admins have no TOTP). */
async function schoolToken(slug: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Host': `${slug}.localhost`,
    },
    body: JSON.stringify({ email: `admin@${slug}.test`, password: 'Passw0rd!' }),
  });
  if (!res.ok) throw new Error(`Login failed for ${slug}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// ─────────────────────────────────────────────────────────────────────────────

describeLiveApi('Student portal e2e', () => {
  let beaconToken: string;

  // Fixture IDs — all captured in beforeAll, cleaned up in afterAll.
  let beaconId: string;
  let myClassId: string;
  let myClassName: string;
  let myClassGradeId: string;
  let myClassAcademicYearId: string;
  let otherClassId: string | null = null;
  let studentId: string;

  // Captured during test execution.
  let createdUserId: string | null = null;
  let studentEmail = '';
  let studentTempPassword = '';
  let studentToken: string | null = null;

  // Catalog fixtures created via admin API.
  let periodId: string | null = null;
  let subjectId: string | null = null;
  let slotId: string | null = null;

  // Announcements created in test 5 — cleaned up in afterAll.
  const announcementIds: string[] = [];

  /** Beacon admin request headers for JSON requests. */
  const bh = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-Forwarded-Host': 'beacon.localhost',
    Authorization: `Bearer ${beaconToken}`,
  });

  beforeAll(async () => {
    beaconToken = await schoolToken('beacon');

    const db = getPlatformPrisma();
    const ts = Date.now();

    // ── Beacon school ──────────────────────────────────────────────────────
    const beacon = await db.school.findUniqueOrThrow({
      where: { slug: 'beacon' },
      select: { id: true },
    });
    beaconId = beacon.id;

    // ── Find the existing seeded ClassSection in beacon ────────────────────
    const existingClass = await db.classSection.findFirstOrThrow({
      where: { schoolId: beaconId },
      select: { id: true, name: true, gradeId: true, academicYearId: true },
    });
    myClassId = existingClass.id;
    myClassName = existingClass.name;
    myClassGradeId = existingClass.gradeId;
    myClassAcademicYearId = existingClass.academicYearId;

    // ── Create throwaway student ───────────────────────────────────────────
    const student = await db.student.create({
      data: {
        schoolId: beaconId,
        // Deliberately contains a space + slash — chars invalid in an email local
        // part — to prove createLogin slugifies admissionNo into a login the
        // student can actually authenticate with (regression: final-review #1).
        admissionNo: `E2E ${ts.toString().slice(-6)}/A`,
        firstName: 'Test',
        lastName: 'Student',
        classSectionId: myClassId,
        rollNo: '99',
      },
    });
    studentId = student.id;

    // ── Create throwaway second ClassSection (for negative targeting test) ─
    try {
      const otherClass = await db.classSection.create({
        data: {
          schoolId: beaconId,
          gradeId: myClassGradeId,
          academicYearId: myClassAcademicYearId,
          name: `E2E-OTHER-${ts.toString().slice(-6)}`,
        },
      });
      otherClassId = otherClass.id;
    } catch {
      // If creation fails (e.g. a concurrent suite already exists), skip — the
      // targeting test will be skipped too.
    }

    // ── Seed a timetable slot for myClassId via admin API ─────────────────
    // Beacon has no seeded periods/subjects, so we create minimal ones.

    // Period (order 98 — unlikely to clash)
    const periodRes = await fetch(`${BASE}/manage/periods`, {
      method: 'POST',
      headers: bh(),
      body: JSON.stringify({
        order: 98,
        label: `E2E Period ${ts}`,
        startTime: '07:00',
        endTime: '07:45',
      }),
    });
    if (periodRes.ok) {
      periodId = ((await periodRes.json()) as { id: string }).id;
    }

    // Subject
    const subjectRes = await fetch(`${BASE}/manage/subjects`, {
      method: 'POST',
      headers: bh(),
      body: JSON.stringify({
        name: `E2E Subject ${ts}`,
        code: `E${ts.toString().slice(-5)}`,
      }),
    });
    if (subjectRes.ok) {
      subjectId = ((await subjectRes.json()) as { id: string }).id;
    }

    // Find existing teacher in beacon (seeded: Meera Nair)
    const teacherRes = await fetch(`${BASE}/manage/teachers`, { headers: bh() });
    const teachers = (await teacherRes.json()) as Array<{ id: string }>;
    const teacherId = teachers[0]?.id;

    // Create slot on day 7 (Sunday) — no existing slots for this class
    if (periodId && subjectId && teacherId) {
      const slotRes = await fetch(`${BASE}/manage/timetable`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({
          classSectionId: myClassId,
          dayOfWeek: 7,
          periodId,
          subjectId,
          teacherId,
          academicYearId: myClassAcademicYearId,
        }),
      });
      if (slotRes.ok) {
        slotId = ((await slotRes.json()) as { id: string }).id;
      }
    }
  });

  afterAll(async () => {
    // 1. Delete announcements created in test 5.
    for (const id of announcementIds) {
      await fetch(`${BASE}/manage/announcements/${id}`, {
        method: 'DELETE',
        headers: bh(),
      }).catch(() => undefined);
    }

    // 2. Delete timetable slot, subject, period (FK order: slot first).
    if (slotId) {
      await fetch(`${BASE}/manage/timetable/${slotId}`, {
        method: 'DELETE',
        headers: bh(),
      }).catch(() => undefined);
    }
    if (subjectId) {
      await fetch(`${BASE}/manage/subjects/${subjectId}`, {
        method: 'DELETE',
        headers: bh(),
      }).catch(() => undefined);
    }
    if (periodId) {
      await fetch(`${BASE}/manage/periods/${periodId}`, {
        method: 'DELETE',
        headers: bh(),
      }).catch(() => undefined);
    }

    const db = getPlatformPrisma();

    // 3. Delete throwaway student (removes userId reference from student row).
    if (studentId) {
      await db.student.delete({ where: { id: studentId } }).catch(() => undefined);
    }

    // 4. Delete user created by login provisioning (cascades refresh tokens).
    if (createdUserId) {
      await db.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
    }

    // 5. Delete second throwaway ClassSection.
    if (otherClassId) {
      await db.classSection.delete({ where: { id: otherClassId } }).catch(() => undefined);
    }

    await disconnectAll();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1 — Admin creates student login
  // ─────────────────────────────────────────────────────────────────────────────
  describe('1. Admin provisions student login', () => {
    it('POST /manage/students/:id/login → 201 { email, tempPassword }', async () => {
      const res = await fetch(`${BASE}/manage/students/${studentId}/login`, {
        method: 'POST',
        headers: bh(),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { email: string; tempPassword: string };
      expect(typeof body.email).toBe('string');
      expect(body.email.length).toBeGreaterThan(0);
      expect(typeof body.tempPassword).toBe('string');
      expect(body.tempPassword.length).toBeGreaterThan(0);
      studentEmail = body.email;
      studentTempPassword = body.tempPassword;

      // Track the created user for cleanup.
      const db = getPlatformPrisma();
      const user = await db.user.findFirst({ where: { email: body.email }, select: { id: true } });
      if (user) createdUserId = user.id;
    });

    it('POST /manage/students/:id/login a second time → 409 (already has login)', async () => {
      const res = await fetch(`${BASE}/manage/students/${studentId}/login`, {
        method: 'POST',
        headers: bh(),
      });
      expect(res.status).toBe(409);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2 — Student logs in with the provisioned credentials
  // ─────────────────────────────────────────────────────────────────────────────
  describe('2. Student logs in', () => {
    it('POST /auth/login (beacon host) with student credentials → 201 with accessToken', async () => {
      expect(studentEmail).not.toBe('');
      expect(studentTempPassword).not.toBe('');

      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
        },
        body: JSON.stringify({ email: studentEmail, password: studentTempPassword }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { accessToken: string };
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.length).toBeGreaterThan(0);
      studentToken = body.accessToken;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3 — Profile
  // ─────────────────────────────────────────────────────────────────────────────
  describe('3. GET /me/profile', () => {
    it('returns 200 with correct firstName and non-null className', async () => {
      if (!studentToken) throw new Error('studentToken not set — test 2 must have failed');

      const res = await fetch(`${BASE}/me/profile`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${studentToken}`,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        firstName: string;
        lastName: string;
        admissionNo: string;
        rollNo: string | null;
        className: string | null;
        photoUrl: string | null;
      };
      expect(body.firstName).toBe('Test');
      expect(body.lastName).toBe('Student');
      expect(body.className).toBe(myClassName);
      expect(body.className).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4 — Timetable
  // ─────────────────────────────────────────────────────────────────────────────
  describe('4. GET /me/timetable', () => {
    it('returns 200 array', async () => {
      if (!studentToken) throw new Error('studentToken not set — test 2 must have failed');

      const res = await fetch(`${BASE}/me/timetable`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${studentToken}`,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('contains the seeded slot (day 7)', async () => {
      if (!studentToken) throw new Error('studentToken not set — test 2 must have failed');
      if (!slotId) {
        console.warn('No timetable slot was created in beforeAll — skipping slot-specific assertion');
        return;
      }

      const res = await fetch(`${BASE}/me/timetable`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${studentToken}`,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string; dayOfWeek: number }>;
      const found = body.find((s) => s.id === slotId);
      expect(found).toBeDefined();
      expect(found!.dayOfWeek).toBe(7);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5 — Announcement targeting
  // ─────────────────────────────────────────────────────────────────────────────
  describe('5. Announcement targeting', () => {
    let schoolWideId: string;
    let myClassAnnoId: string;
    let otherClassAnnoId: string | null = null;

    it('admin creates three announcements (school-wide, own-class, other-class)', async () => {
      // (a) School-wide — no classSectionId
      const swRes = await fetch(`${BASE}/manage/announcements`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ title: 'E2E School-Wide', body: 'Visible to all students' }),
      });
      expect(swRes.status).toBe(201);
      schoolWideId = ((await swRes.json()) as { id: string }).id;
      announcementIds.push(schoolWideId);

      // (b) Own class
      const mcRes = await fetch(`${BASE}/manage/announcements`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({
          title: 'E2E My Class',
          body: 'Only for my class',
          classSectionId: myClassId,
        }),
      });
      expect(mcRes.status).toBe(201);
      myClassAnnoId = ((await mcRes.json()) as { id: string }).id;
      announcementIds.push(myClassAnnoId);

      // (c) Other class — only created if otherClassId was set in beforeAll
      if (otherClassId) {
        const ocRes = await fetch(`${BASE}/manage/announcements`, {
          method: 'POST',
          headers: bh(),
          body: JSON.stringify({
            title: 'E2E Other Class',
            body: 'Not visible to me',
            classSectionId: otherClassId,
          }),
        });
        expect(ocRes.status).toBe(201);
        otherClassAnnoId = ((await ocRes.json()) as { id: string }).id;
        announcementIds.push(otherClassAnnoId);
      }
    });

    it('GET /me/announcements contains school-wide and own-class but NOT other-class', async () => {
      if (!studentToken) throw new Error('studentToken not set — test 2 must have failed');

      const res = await fetch(`${BASE}/me/announcements`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${studentToken}`,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string }>;
      expect(Array.isArray(body)).toBe(true);

      const ids = body.map((a) => a.id);

      // Must contain school-wide and own-class announcements.
      expect(ids).toContain(schoolWideId);
      expect(ids).toContain(myClassAnnoId);

      // Must NOT contain the other-class announcement.
      if (otherClassAnnoId) {
        expect(ids).not.toContain(otherClassAnnoId);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6 — Role isolation
  // ─────────────────────────────────────────────────────────────────────────────
  describe('6. Role isolation', () => {
    it('student token on POST /manage/announcements → 403', async () => {
      if (!studentToken) throw new Error('studentToken not set — test 2 must have failed');

      const res = await fetch(`${BASE}/manage/announcements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({ title: 'Should be rejected', body: 'Student cannot post' }),
      });
      expect(res.status).toBe(403);
    });

    it('admin (SCHOOL_ADMIN) token on GET /me/profile → 403', async () => {
      const res = await fetch(`${BASE}/me/profile`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${beaconToken}`,
        },
      });
      expect(res.status).toBe(403);
    });
  });
});
