import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';
import type { PrismaClient } from '@skoolos/db';

describe('RLS on the new management tables', () => {
  let acmeId: string;
  let beaconId: string;
  let acmeSection: string;
  let beaconSection: string;
  let acmeSubject: string;
  let beaconSubject: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const acme = await p.school.upsert({
      where: { slug: 'rls-acme' },
      update: {},
      create: { slug: 'rls-acme', name: 'Acme', tier: 'STANDARD', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'rls-beacon' },
      update: {},
      create: { slug: 'rls-beacon', name: 'Beacon', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;
    // Build one class section per school. Read test/management.e2e-spec.ts for
    // the exact academicYear/grade scaffolding this needs and reuse it.
    acmeSection = await makeSection(p, acmeId, 'A');
    beaconSection = await makeSection(p, beaconId, 'B');
    // ClassNote.subjectId is required — one Subject per school, reused by both notes below.
    acmeSubject = await makeSubject(p, acmeId, 'A');
    beaconSubject = await makeSubject(p, beaconId, 'B');

    await p.classNote.create({
      data: { schoolId: acmeId, classSectionId: acmeSection, subjectId: acmeSubject, date: new Date('2026-08-03'),
              body: 'acme note', authorTeacherId: acmeId },
    });
    await p.classNote.create({
      data: { schoolId: beaconId, classSectionId: beaconSection, subjectId: beaconSubject, date: new Date('2026-08-03'),
              body: 'beacon note', authorTeacherId: beaconId },
    });
  });

  afterAll(async () => { await disconnectAll(); });

  it('a tenant sees only its own class notes', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.classNote.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0].body).toBe('acme note');
  });

  it('a tenant cannot forge a note owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.classNote.create({
          data: { schoolId: beaconId, classSectionId: beaconSection, subjectId: beaconSubject,
                  date: new Date('2026-08-03'), body: 'x', authorTeacherId: acmeId },
        }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('a tenant sees only its own register change requests', async () => {
    await withTenant(acmeId, (tx) =>
      tx.registerChangeRequest.create({
        data: { schoolId: acmeId, classSectionId: acmeSection, date: new Date('2026-07-31'),
                requestedByTeacherId: acmeId, reason: 'late slip' },
      }),
    );
    const mine = await withTenant(acmeId, (tx) => tx.registerChangeRequest.findMany());
    const theirs = await withTenant(beaconId, (tx) => tx.registerChangeRequest.findMany());
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(0);
  });

  // ── Assignments (T21, Phase 4 Task 4) ──────────────────────────────────────
  describe('Assignment / AssignmentSeen', () => {
    let acmeAssignment: string;
    let beaconAssignment: string;
    let acmeStudent: string;

    beforeAll(async () => {
      const p = getPlatformPrisma();
      acmeStudent = await makeStudent(p, acmeId, acmeSection, 'A');

      const created = await p.assignment.create({
        data: {
          schoolId: acmeId,
          classSectionId: acmeSection,
          subjectId: acmeSubject,
          title: 'Acme worksheet',
          instructions: 'Do it.',
          dueDate: new Date('2026-08-05'),
          createdByTeacherId: acmeId,
        },
      });
      acmeAssignment = created.id;
      const createdBeacon = await p.assignment.create({
        data: {
          schoolId: beaconId,
          classSectionId: beaconSection,
          subjectId: beaconSubject,
          title: 'Beacon worksheet',
          instructions: 'Do it.',
          dueDate: new Date('2026-08-05'),
          createdByTeacherId: beaconId,
        },
      });
      beaconAssignment = createdBeacon.id;
    });

    it('a tenant sees only its own assignments', async () => {
      const mine = await withTenant(acmeId, (tx) => tx.assignment.findMany());
      expect(mine.length).toBe(1);
      expect(mine[0].title).toBe('Acme worksheet');
    });

    it('a tenant cannot forge an assignment owned by another school', async () => {
      await expect(
        withTenant(acmeId, (tx) =>
          tx.assignment.create({
            data: {
              schoolId: beaconId,
              classSectionId: beaconSection,
              subjectId: beaconSubject,
              title: 'x',
              instructions: 'x',
              dueDate: new Date('2026-08-05'),
              createdByTeacherId: acmeId,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security|42501/);
    });

    // AssignmentSeen has no schoolId column of its own — its RLS policy is
    // derived via assignmentId -> Assignment.schoolId (the SAME pattern
    // Result uses for examId -> Exam.schoolId). This proves that derived
    // policy actually isolates tenants, not just the direct-column ones above.
    it('a tenant sees only its own AssignmentSeen rows (derived tenancy via assignmentId -> Assignment.schoolId)', async () => {
      await withTenant(acmeId, (tx) =>
        tx.assignmentSeen.create({ data: { assignmentId: acmeAssignment, studentId: acmeStudent } }),
      );
      const mine = await withTenant(acmeId, (tx) => tx.assignmentSeen.findMany());
      const theirs = await withTenant(beaconId, (tx) => tx.assignmentSeen.findMany());
      expect(mine.length).toBe(1);
      expect(theirs.length).toBe(0);
    });

    it('a tenant cannot forge an AssignmentSeen row against another school\'s assignment', async () => {
      // From ACME's tenant context, point assignmentId at BEACON's own
      // Assignment row. AssignmentSeen's WITH CHECK derives tenancy via
      // `EXISTS (SELECT 1 FROM Assignment a WHERE a.id = assignmentId AND
      // a.schoolId = current_tenant)` — beaconAssignment's schoolId is
      // beaconId, not acmeId, so this EXISTS is false and the insert is
      // rejected by RLS, never silently attributing a beacon assignment's
      // seen-mark to an acme student.
      await expect(
        withTenant(acmeId, (tx) =>
          tx.assignmentSeen.create({
            data: { assignmentId: beaconAssignment, studentId: acmeStudent },
          }),
        ),
      ).rejects.toThrow(/row-level security|42501/);
    });
  });

  // ── Messaging (T17, Phase 4 Task 5) ────────────────────────────────────────
  describe('MessageThread / Message', () => {
    let acmeThread: string;
    let beaconThread: string;

    beforeAll(async () => {
      const p = getPlatformPrisma();
      const acmeTeacher = await makeTeacher(p, acmeId, 'A');
      const beaconTeacher = await makeTeacher(p, beaconId, 'B');
      const acmeStudent = await makeStudent(p, acmeId, acmeSection, 'MA');
      const beaconStudent = await makeStudent(p, beaconId, beaconSection, 'MB');

      const at = await p.messageThread.create({
        data: { schoolId: acmeId, studentId: acmeStudent, teacherId: acmeTeacher, subjectId: acmeSubject, classSectionId: acmeSection },
      });
      acmeThread = at.id;
      const bt = await p.messageThread.create({
        data: { schoolId: beaconId, studentId: beaconStudent, teacherId: beaconTeacher, subjectId: beaconSubject, classSectionId: beaconSection },
      });
      beaconThread = bt.id;

      await p.message.create({ data: { schoolId: acmeId, threadId: acmeThread, senderRole: 'STUDENT', body: 'acme msg' } });
      await p.message.create({ data: { schoolId: beaconId, threadId: beaconThread, senderRole: 'STUDENT', body: 'beacon msg' } });
    });

    it('a tenant sees only its own message threads', async () => {
      const mine = await withTenant(acmeId, (tx) => tx.messageThread.findMany());
      expect(mine.length).toBe(1);
      expect(mine[0].id).toBe(acmeThread);
    });

    it('a tenant cannot forge a thread owned by another school', async () => {
      await expect(
        withTenant(acmeId, (tx) =>
          tx.messageThread.create({
            data: { schoolId: beaconId, studentId: acmeThread, teacherId: acmeThread, subjectId: beaconSubject, classSectionId: beaconSection },
          }),
        ),
      ).rejects.toThrow(/row-level security|42501/);
    });

    it('a tenant sees only its own messages', async () => {
      const mine = await withTenant(acmeId, (tx) => tx.message.findMany());
      expect(mine.length).toBe(1);
      expect(mine[0].body).toBe('acme msg');
    });

    it('a tenant cannot forge a message into another school', async () => {
      await expect(
        withTenant(acmeId, (tx) =>
          tx.message.create({ data: { schoolId: beaconId, threadId: beaconThread, senderRole: 'STUDENT', body: 'x' } }),
        ),
      ).rejects.toThrow(/row-level security|42501/);
    });
  });
});

/**
 * Creates a minimal AcademicYear + Grade + ClassSection for `schoolId` and
 * returns the ClassSection id. Field requirements copied from
 * packages/db/prisma/schema.prisma (AcademicYear, Grade, ClassSection).
 */
async function makeSection(
  p: PrismaClient,
  schoolId: string,
  label: string,
): Promise<string> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const academicYear = await p.academicYear.create({
    data: {
      schoolId,
      name: `AY-${label}-${suffix}`,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });
  const grade = await p.grade.create({
    data: { schoolId, name: `Grade-${label}-${suffix}`, order: 1 },
  });
  const classSection = await p.classSection.create({
    data: {
      schoolId,
      gradeId: grade.id,
      academicYearId: academicYear.id,
      name: `Section-${label}-${suffix}`,
    },
  });
  return classSection.id;
}

/** Creates a minimal Subject for `schoolId` and returns its id. */
async function makeSubject(p: PrismaClient, schoolId: string, label: string): Promise<string> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const subject = await p.subject.create({
    data: { schoolId, name: `Subject-${label}-${suffix}`, code: `SUB-${label}-${suffix}` },
  });
  return subject.id;
}

/** Creates a minimal Teacher for `schoolId` and returns its id (a real FK target
 * for MessageThread.teacherId). No linked userId — RLS isolation is by schoolId. */
async function makeTeacher(p: PrismaClient, schoolId: string, label: string): Promise<string> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const teacher = await p.teacher.create({
    data: { schoolId, firstName: `Teacher-${label}`, lastName: suffix },
  });
  return teacher.id;
}

/** Creates a minimal Student in `classSectionId` for `schoolId` and returns its id. */
async function makeStudent(
  p: PrismaClient,
  schoolId: string,
  classSectionId: string,
  label: string,
): Promise<string> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const student = await p.student.create({
    data: {
      schoolId,
      classSectionId,
      admissionNo: `ADM-${label}-${suffix}`,
      firstName: `Student-${label}`,
      lastName: suffix,
    },
  });
  return student.id;
}
