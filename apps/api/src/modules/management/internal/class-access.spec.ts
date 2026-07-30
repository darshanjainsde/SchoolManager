import { requireClassAccess, canReadClassNotes } from './class-access';

const tx = () => ({
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
});

const readTx = () => ({
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  school: { findUnique: jest.fn() },
  timetableSlot: { findFirst: jest.fn() },
});

const DATE = '2026-08-03';
const SCHOOL = 'school-1';
const SECTION = 'sec-8c';
const MATHS = 'subj-maths';
const ENGLISH = 'subj-english';

/**
 * Faithful-enough Prisma `where` matcher: a key ABSENT from `where` imposes no
 * constraint (real SQL semantics), so if production code ever drops a filter
 * (e.g. stops passing `subjectId`), a fixture that only differs on that field
 * starts matching — unlike a plain `mockResolvedValue`, which can't see what
 * args it was even called with. This is what makes the "different
 * subject"/"different date" tests below actually fail if that logic is
 * deleted, rather than passing regardless.
 */
function matchesWhere(where: Record<string, unknown>, record: Record<string, unknown>): boolean {
  return Object.keys(record).every((k) => {
    if (!(k in where)) return true;
    const w = where[k];
    const v = record[k];
    if (w instanceof Date && v instanceof Date) return w.getTime() === v.getTime();
    return w === v;
  });
}

/** A `findFirst` stub backed by a tiny in-memory fixture list, matched via `matchesWhere`. */
function fixtureFindFirst(records: Record<string, unknown>[]) {
  return jest.fn(async (args: { where: Record<string, unknown> }) => {
    const found = records.find((r) => matchesWhere(args.where, r));
    return found ?? null;
  });
}

describe('requireClassAccess', () => {
  it('returns the teacher id when they are the class teacher or hold a slot', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue({ id: 'sec-1' });

    await expect(requireClassAccess(t, 'user-1', 'sec-1', DATE)).resolves.toBe('teacher-1');
    expect(t.substitution.findFirst).not.toHaveBeenCalled();
  });

  it('returns the teacher id when they are the substitute on that date', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).resolves.toBe('teacher-1');
  });

  it('scopes the substitution grant to the exact date asked about', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).rejects.toMatchObject({
      status: 403,
    });
    expect(t.substitution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ date: new Date(DATE), substituteTeacherId: 'teacher-1' }),
      }),
    );
  });

  it('does not grant access via a slot closed before the queried date', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    // Simulates the DB excluding a slot whose effectiveTo <= asOf (closed before DATE).
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).rejects.toMatchObject({
      status: 403,
    });

    const asOf = new Date(`${DATE}T00:00:00+05:30`);
    expect(t.classSection.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'sec-9',
        OR: [
          { classTeacherId: 'teacher-1' },
          {
            timetableSlots: {
              some: {
                teacherId: 'teacher-1',
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it('does not grant access via a slot whose effectiveFrom is still in the future', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    // Simulates the DB excluding a slot whose effectiveFrom > asOf (not yet active on DATE).
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).rejects.toMatchObject({
      status: 403,
    });

    const asOf = new Date(`${DATE}T00:00:00+05:30`);
    expect(t.classSection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              timetableSlots: {
                some: {
                  teacherId: 'teacher-1',
                  effectiveFrom: { lte: asOf },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
                },
              },
            }),
          ]),
        }),
      }),
    );
  });

  it('403s a caller with no Teacher row', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-admin', 'sec-1', DATE)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('names the action in the message so each caller reads naturally', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(
      requireClassAccess(t, 'user-1', 'sec-9', DATE, 'add notes to'),
    ).rejects.toMatchObject({ message: 'You can only add notes to your own classes.' });
  });
});

describe('canReadClassNotes', () => {
  it('SCHOOL_ADMIN reads regardless, without even resolving a Teacher row', async () => {
    const t = readTx();

    await expect(
      canReadClassNotes(t, 'user-admin', 'SCHOOL_ADMIN', SCHOOL, SECTION, MATHS, DATE),
    ).resolves.toBe(true);
    expect(t.teacher.findFirst).not.toHaveBeenCalled();
  });

  it('a caller with no Teacher row cannot read', async () => {
    const t = readTx();
    t.teacher.findFirst.mockResolvedValue(null);

    await expect(
      canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
    ).resolves.toBe(false);
  });

  describe('under ALL_TEACHERS', () => {
    it('any teacher holding the section can read, regardless of subject', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'ALL_TEACHERS' });
      // Holds the section via a Physics slot, but the note being read is Maths —
      // ALL_TEACHERS must not care.
      t.classSection.findFirst.mockResolvedValue({ id: SECTION });

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(true);
      expect(t.timetableSlot.findFirst).not.toHaveBeenCalled();
    });

    it('a teacher who neither holds nor substitutes the section cannot read', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'ALL_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null);
      t.substitution.findFirst.mockResolvedValue(null);

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(false);
    });
  });

  describe('under SUBJECT_TEACHERS', () => {
    beforeEach(() => {
      // Defaults for this block; individual tests override as needed.
    });

    it('a teacher holding a slot for that section AND subject can read', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null); // not the class teacher
      t.timetableSlot.findFirst.mockResolvedValue({ id: 'slot-1' });

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(true);
      expect(t.timetableSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ classSectionId: SECTION, subjectId: MATHS, teacherId: 'teacher-1' }),
        }),
      );
    });

    it('a teacher who teaches a DIFFERENT subject in the same section cannot read — the whole point of this feature', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null); // not the class teacher
      // The teacher DOES hold a slot in this section — for English, not Maths.
      // If the code ever stopped filtering on subjectId, this fixture would
      // still be found (classSectionId + teacherId alone match) and the read
      // would be wrongly granted.
      t.timetableSlot.findFirst = fixtureFindFirst([
        { classSectionId: SECTION, subjectId: ENGLISH, teacherId: 'teacher-1' },
      ]);
      t.substitution.findFirst.mockResolvedValue(null); // not covering either

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(false);
    });

    it('the class teacher can read a subject they do not teach', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue({ id: SECTION }); // is the class teacher

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(true);
      // The class teacher grant is cheapest-first: never needed the slot query.
      expect(t.timetableSlot.findFirst).not.toHaveBeenCalled();
    });

    it('a substitute covering that section on that date, in a period teaching that subject, can read', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null);
      t.timetableSlot.findFirst
        .mockResolvedValueOnce(null) // own slot check: no
        .mockResolvedValueOnce({ id: 'slot-2' }); // covered period's slot teaches MATHS
      t.substitution.findFirst.mockResolvedValue({ periodId: 'period-3' });

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(true);
      expect(t.timetableSlot.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ classSectionId: SECTION, periodId: 'period-3', subjectId: MATHS }),
        }),
      );
    });

    it('a substitute covering that section on a DIFFERENT date cannot read — the grant is one day', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null);
      // period-3 genuinely teaches Maths (held by a different, original
      // teacher) — so if the date filter below were ever dropped, the
      // covered-period lookup WOULD find it and wrongly grant access. This is
      // what makes this test fail if the date-scoping is deleted, rather than
      // trivially passing because nothing was ever found.
      t.timetableSlot.findFirst = fixtureFindFirst([
        { classSectionId: SECTION, periodId: 'period-3', subjectId: MATHS, teacherId: 'original-teacher' },
      ]);
      // The substitution really exists — just not on DATE. If the code ever
      // stopped filtering the substitution query by `date`, this fixture would
      // still be found (classSectionId + substituteTeacherId alone match).
      const OTHER_DATE = '2026-08-04';
      t.substitution.findFirst = fixtureFindFirst([
        { classSectionId: SECTION, date: new Date(OTHER_DATE), substituteTeacherId: 'teacher-1', periodId: 'period-3' },
      ]);

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(false);
    });

    it('a substitute covering a period teaching a DIFFERENT subject cannot read', async () => {
      const t = readTx();
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null);
      t.substitution.findFirst.mockResolvedValue({ periodId: 'period-3' });
      // Own slot: none. Covered period's slot: really exists, but teaches
      // English — same "field absent still matches" trap as the test above,
      // this time on the covered-period lookup's subjectId filter.
      t.timetableSlot.findFirst = fixtureFindFirst([
        { classSectionId: SECTION, periodId: 'period-3', subjectId: ENGLISH },
      ]);

      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE),
      ).resolves.toBe(false);
    });

    it('a substitute covering period-3 on a WEDNESDAY cannot read Maths notes that period only teaches on MONDAY — same periodId, different weekday, different subject', async () => {
      const t = readTx();
      const WEDNESDAY = '2026-08-05'; // isoWeekdayOf → 3
      t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      t.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
      t.classSection.findFirst.mockResolvedValue(null); // not the class teacher
      t.substitution.findFirst.mockResolvedValue({ periodId: 'period-3' }); // covering period-3 on WEDNESDAY
      // period-3 legitimately maps to two different subjects depending on the
      // day (TimetableSlot's uniqueness key includes dayOfWeek): Maths on
      // Monday (dayOfWeek 1), English on Wednesday (dayOfWeek 3). Both slots
      // belong to someone else, so the "own slot" check must also miss.
      t.timetableSlot.findFirst = fixtureFindFirst([
        {
          classSectionId: SECTION,
          periodId: 'period-3',
          subjectId: MATHS,
          teacherId: 'monday-teacher',
          dayOfWeek: 1,
        },
        {
          classSectionId: SECTION,
          periodId: 'period-3',
          subjectId: ENGLISH,
          teacherId: 'wednesday-teacher',
          dayOfWeek: 3,
        },
      ]);

      // The substitute is covering on a Wednesday, so asking for Maths notes
      // (Monday's subject in that period) must be refused — without a
      // dayOfWeek filter on the covered-slot lookup, the Monday Maths slot
      // still matches on classSectionId+periodId+subjectId alone and wrongly
      // grants access.
      await expect(
        canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, WEDNESDAY),
      ).resolves.toBe(false);
    });
  });

  it('reads the visibility setting fresh on every call — not cached in module scope', async () => {
    const t = readTx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue({ id: SECTION }); // ALL_TEACHERS: holds the section
    t.school.findUnique
      .mockResolvedValueOnce({ classNoteVisibility: 'ALL_TEACHERS' })
      .mockResolvedValueOnce({ classNoteVisibility: 'SUBJECT_TEACHERS' });

    await canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE);
    // Second call: same school, but now SUBJECT_TEACHERS and no class-teacher
    // row and no matching slot — must come back false, proving the fresh read
    // actually changed behaviour rather than a first-call cache winning.
    t.classSection.findFirst.mockResolvedValue(null);
    t.timetableSlot.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);
    const second = await canReadClassNotes(t, 'user-1', 'TEACHER', SCHOOL, SECTION, MATHS, DATE);

    expect(second).toBe(false);
    expect(t.school.findUnique).toHaveBeenCalledTimes(2);
  });
});
