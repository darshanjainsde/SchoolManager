/**
 * MANAGEMENT E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * These tests call the running API over HTTP, so any Prisma usage here MUST
 * target the SAME database as that API.
 * Locally: boot the API against the dev DB and run jest with
 *   DATABASE_URL_TEST=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public
 * In CI: boot the API against skoolos_test and omit DATABASE_URL_TEST.
 *
 * Seeded credentials used here:
 *   acme admin:   admin@acme.test   / Passw0rd!  host: acme.localhost   tier: STANDARD (no MANAGEMENT)
 *   beacon admin: admin@beacon.test / Passw0rd!  host: beacon.localhost  tier: PRO (MANAGEMENT included)
 *
 * Proved by this suite:
 *   1. Feature gate  — acme (STANDARD) → 403 on every /manage/* route; beacon (PRO) → 200.
 *   2. Isolation     — beacon token on acme host → 401; no token → 401.
 *   3. Clash         — class clash → 409 "class already has a subject"; teacher clash → 409 "teacher is already booked".
 *   4. Availability  — GET /manage/availability reflects the assigned slot in the busy array.
 *   5. Cleanup       — afterAll deletes all rows created by this suite (slots→classes→teacher→subject→period→grade).
 */

const BASE = 'http://localhost:3001';

/** Obtain a school-scoped JWT without TOTP (school admins have no TOTP). */
async function schoolToken(slug: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Host': `${slug}.localhost`,
    },
    body: JSON.stringify({ email: `admin@${slug}.test`, password: 'Passw0rd!' }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${slug}: ${res.status} ${await res.text()}`);
  }
  const body = await res.json() as { accessToken: string };
  return body.accessToken;
}

describe('Management e2e', () => {
  let beaconToken: string;
  let acmeToken: string;

  beforeAll(async () => {
    [beaconToken, acmeToken] = await Promise.all([
      schoolToken('beacon'),
      schoolToken('acme'),
    ]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Feature gate
  // ──────────────────────────────────────────────────────────────────────────
  describe('feature gate', () => {
    // A syntactically valid UUID that doesn't exist in the DB — lets ParseUUIDPipe
    // pass for /manage/timetable so the guard result (not pipe validation) determines the status.
    const FAKE_UUID = '00000000-0000-4000-8000-000000000001';

    const routes = [
      `${BASE}/manage/grades`,
      `${BASE}/manage/teachers`,
      `${BASE}/manage/classes`,
      `${BASE}/manage/students`,
      `${BASE}/manage/timetable?classSectionId=${FAKE_UUID}`,
      `${BASE}/manage/availability`,
    ];

    it('acme (STANDARD, no MANAGEMENT) → 403 on every /manage/* route', async () => {
      for (const url of routes) {
        const res = await fetch(url, {
          headers: {
            'X-Forwarded-Host': 'acme.localhost',
            Authorization: `Bearer ${acmeToken}`,
          },
        });
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
    });

    it('beacon (PRO, has MANAGEMENT) → 200 on every /manage/* route', async () => {
      for (const url of routes) {
        const res = await fetch(url, {
          headers: {
            'X-Forwarded-Host': 'beacon.localhost',
            Authorization: `Bearer ${beaconToken}`,
          },
        });
        expect({ url, status: res.status }).toEqual({ url, status: 200 });
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Isolation — host/token mismatch and missing token
  // ──────────────────────────────────────────────────────────────────────────
  describe('isolation', () => {
    it('beacon token sent to acme host → 401 (tenant mismatch)', async () => {
      const res = await fetch(`${BASE}/manage/grades`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${beaconToken}`,
        },
      });
      expect(res.status).toBe(401);
    });

    it('no Authorization header → 401', async () => {
      const res = await fetch(`${BASE}/manage/grades`, {
        headers: { 'X-Forwarded-Host': 'beacon.localhost' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3 + 4. Clash detection + availability — all as beacon admin
  // ──────────────────────────────────────────────────────────────────────────
  describe('clash detection and availability', () => {
    /** Beacon-scoped headers for JSON requests. */
    const bh = (): Record<string, string> => ({
      'Content-Type': 'application/json',
      'X-Forwarded-Host': 'beacon.localhost',
      Authorization: `Bearer ${beaconToken}`,
    });

    const DAY = 3; // Wednesday

    // IDs captured during setup — used in assertions and afterAll cleanup.
    let gradeId: string;
    let subjectId: string;
    let periodId: string;
    let teacherId: string;
    let yearId: string;
    let classSectionId: string;
    let classSectionId2: string;
    let slotId: string;

    afterAll(async () => {
      // Delete in reverse FK order: slot → classes → teacher → subject → period → grade.
      // Errors are intentionally swallowed so partial cleanup doesn't block the suite exit.
      const headers = {
        'X-Forwarded-Host': 'beacon.localhost',
        Authorization: `Bearer ${beaconToken}`,
      };
      const del = (path: string) =>
        fetch(`${BASE}${path}`, { method: 'DELETE', headers }).catch(() => undefined);

      if (slotId) await del(`/manage/timetable/${slotId}`);
      // Delete class 2 first (no slots), then class 1 (slot already gone).
      if (classSectionId2) await del(`/manage/classes/${classSectionId2}`);
      if (classSectionId) await del(`/manage/classes/${classSectionId}`);
      if (teacherId) await del(`/manage/teachers/${teacherId}`);
      if (subjectId) await del(`/manage/subjects/${subjectId}`);
      if (periodId) await del(`/manage/periods/${periodId}`);
      if (gradeId) await del(`/manage/grades/${gradeId}`);
    });

    // ── Setup ──────────────────────────────────────────────────────────────

    it('creates test fixtures: grade, subject, period, teacher, two class sections', async () => {
      const ts = Date.now();

      // Grade
      const gRes = await fetch(`${BASE}/manage/grades`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ name: `E2E Grade ${ts}`, order: 99 }),
      });
      expect(gRes.status).toBe(201);
      gradeId = ((await gRes.json()) as { id: string }).id;
      expect(typeof gradeId).toBe('string');

      // Subject
      const sRes = await fetch(`${BASE}/manage/subjects`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ name: `E2E Subject ${ts}`, code: `E${ts % 100000}` }),
      });
      expect(sRes.status).toBe(201);
      subjectId = ((await sRes.json()) as { id: string }).id;

      // Period
      const pRes = await fetch(`${BASE}/manage/periods`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ order: 99, label: `E2E Period ${ts}`, startTime: '08:00', endTime: '08:45' }),
      });
      expect(pRes.status).toBe(201);
      periodId = ((await pRes.json()) as { id: string }).id;

      // Teacher
      const tRes = await fetch(`${BASE}/manage/teachers`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ firstName: 'E2E', lastName: `Teacher${ts}` }),
      });
      expect(tRes.status).toBe(201);
      teacherId = ((await tRes.json()) as { id: string }).id;

      // Use the seeded 2026-27 academic year (isCurrent: true for beacon PRO)
      const yRes = await fetch(`${BASE}/manage/years`, { headers: bh() });
      expect(yRes.status).toBe(200);
      const years = (await yRes.json()) as Array<{ id: string; isCurrent: boolean }>;
      const current = years.find((y) => y.isCurrent);
      expect(current).toBeDefined();
      yearId = current!.id;

      // Class section 1
      const c1Res = await fetch(`${BASE}/manage/classes`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ gradeId, name: `E2E-A-${ts}`, academicYearId: yearId }),
      });
      expect(c1Res.status).toBe(201);
      classSectionId = ((await c1Res.json()) as { id: string }).id;

      // Class section 2 — for the teacher-clash test (different class, same teacher+period)
      const c2Res = await fetch(`${BASE}/manage/classes`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({ gradeId, name: `E2E-B-${ts}`, academicYearId: yearId }),
      });
      expect(c2Res.status).toBe(201);
      classSectionId2 = ((await c2Res.json()) as { id: string }).id;
    });

    // ── Slot assignment ────────────────────────────────────────────────────

    it('assigns a timetable slot to class 1 on day 3 period (→ 201)', async () => {
      const res = await fetch(`${BASE}/manage/timetable`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({
          classSectionId,
          dayOfWeek: DAY,
          periodId,
          subjectId,
          teacherId,
          academicYearId: yearId,
        }),
      });
      expect(res.status).toBe(201);
      slotId = ((await res.json()) as { id: string }).id;
      expect(typeof slotId).toBe('string');
    });

    // ── Clash 1: same class + day + period ────────────────────────────────

    it('returns 409 with class-clash message when the same class has a slot in that period', async () => {
      const res = await fetch(`${BASE}/manage/timetable`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({
          classSectionId, // same class
          dayOfWeek: DAY,
          periodId,       // same period
          subjectId,
          teacherId,      // class clash fires before teacher clash
          academicYearId: yearId,
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { message: string };
      expect(body.message).toMatch(/class already has a subject/i);
    });

    // ── Clash 2: different class, same teacher + day + period ─────────────

    it('returns 409 with teacher-clash message when the teacher is already booked in that period', async () => {
      const res = await fetch(`${BASE}/manage/timetable`, {
        method: 'POST',
        headers: bh(),
        body: JSON.stringify({
          classSectionId: classSectionId2, // different class — avoids class clash
          dayOfWeek: DAY,
          periodId,                        // same period
          subjectId,
          teacherId,                       // same teacher → teacher clash
          academicYearId: yearId,
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { message: string };
      expect(body.message).toMatch(/teacher is already booked/i);
    });

    // ── Availability ──────────────────────────────────────────────────────

    it('GET /manage/availability returns the assigned teacher as busy in that day+period', async () => {
      const res = await fetch(
        `${BASE}/manage/availability?academicYearId=${yearId}`,
        { headers: bh() },
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        teachers: Array<{ id: string; firstName: string; lastName: string }>;
        periods: Array<{ id: string; order: number; label: string }>;
        busy: Array<{ teacherId: string; dayOfWeek: number; periodId: string }>;
      };

      expect(Array.isArray(body.teachers)).toBe(true);
      expect(Array.isArray(body.periods)).toBe(true);
      expect(Array.isArray(body.busy)).toBe(true);

      // The assigned teacher appears in the teachers list (isActive defaults to true)
      const teacher = body.teachers.find((t) => t.id === teacherId);
      expect(teacher).toBeDefined();

      // The assigned period appears in the periods list
      const period = body.periods.find((p) => p.id === periodId);
      expect(period).toBeDefined();

      // The slot we created appears in busy
      const busyEntry = body.busy.find(
        (e) => e.teacherId === teacherId && e.dayOfWeek === DAY && e.periodId === periodId,
      );
      expect(busyEntry).toBeDefined();
    });
  });
});
