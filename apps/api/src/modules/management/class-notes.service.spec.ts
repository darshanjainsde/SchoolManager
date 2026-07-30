const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  school: { findUnique: jest.fn() },
  timetableSlot: { findFirst: jest.fn() },
  classNote: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  classTodo: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { ClassNotesService } from './class-notes.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const DATE = '2026-08-03';
const MATHS = 'subj-maths';
const HISTORY = 'subj-history';

describe('ClassNotesService', () => {
  const svc = new ClassNotesService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'ALL_TEACHERS' });
    txMock.timetableSlot.findFirst.mockResolvedValue(null);
    txMock.classNote.findMany.mockResolvedValue([]);
    txMock.classTodo.findMany.mockResolvedValue([]);
  });

  it('reads notes and to-dos for one class and date together', async () => {
    txMock.classNote.findMany.mockResolvedValue([
      { id: 'n1', body: 'Finished 7.3', createdAt: new Date('2026-08-03T09:40:00Z'), authorTeacherId: TID },
    ]);
    txMock.classTodo.findMany.mockResolvedValue([
      { id: 't1', body: 'Collect worksheets', done: false, createdAt: new Date(), authorTeacherId: TID },
    ]);

    const out = await svc.list(SCHOOL, SECTION, DATE, MATHS, USER, 'TEACHER');

    expect(out.notes).toHaveLength(1);
    expect(out.todos).toHaveLength(1);
    // ALL_TEACHERS: the whole class's log — not filtered to one subject.
    expect(txMock.classNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classSectionId: SECTION, date: new Date(DATE) } }),
    );
  });

  it('rejects a malformed date', async () => {
    await expect(svc.list(SCHOOL, SECTION, '3-8-2026', MATHS, USER, 'TEACHER')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('list filters to the requested subject under SUBJECT_TEACHERS', async () => {
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
    // Class teacher of the section, so the read-access check passes regardless
    // of subject — this test is about the WHERE filter, not the authz rule
    // itself (that's class-access.spec.ts's job).
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });

    await svc.list(SCHOOL, SECTION, DATE, MATHS, USER, 'TEACHER');

    expect(txMock.classNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classSectionId: SECTION, date: new Date(DATE), subjectId: MATHS } }),
    );
    expect(txMock.classTodo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classSectionId: SECTION, date: new Date(DATE), subjectId: MATHS } }),
    );
  });

  it('list 403s when the caller may not read that subject under SUBJECT_TEACHERS', async () => {
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
    txMock.classSection.findFirst.mockResolvedValue(null); // not the class teacher
    txMock.timetableSlot.findFirst.mockResolvedValue(null); // no slot for this subject
    txMock.substitution.findFirst.mockResolvedValue(null); // not covering

    await expect(svc.list(SCHOOL, SECTION, DATE, MATHS, USER, 'TEACHER')).rejects.toMatchObject({
      status: 403,
    });
    expect(txMock.classNote.findMany).not.toHaveBeenCalled();
  });

  it('adds a note attributed to the calling teacher', async () => {
    txMock.classNote.create.mockResolvedValue({ id: 'n2', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await svc.addNote(SCHOOL, USER, 'TEACHER', { classSectionId: SECTION, subjectId: MATHS, date: DATE, body: 'x' });

    expect(txMock.classNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorTeacherId: TID, classSectionId: SECTION, subjectId: MATHS, body: 'x' }),
      }),
    );
  });

  it('refuses to write a note for a class the teacher does not hold', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);

    await expect(
      svc.addNote(SCHOOL, USER, 'TEACHER', { classSectionId: 'sec-other', subjectId: MATHS, date: DATE, body: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(txMock.classNote.create).not.toHaveBeenCalled();
  });

  it('lets a substitute write a note for the day they are covering', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    txMock.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });
    txMock.classNote.create.mockResolvedValue({ id: 'n3', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await expect(
      svc.addNote(SCHOOL, USER, 'TEACHER', { classSectionId: 'sec-9a', subjectId: MATHS, date: DATE, body: 'x' }),
    ).resolves.toBeDefined();
  });

  it('addNote 403s when the caller may not read that subject’s notes, even though they hold the class', async () => {
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
    // Write gate (requireClassAccess) passes: holds the section via a slot in
    // some OTHER subject. Read gate (canReadClassNotes) must still say no.
    txMock.classSection.findFirst
      .mockResolvedValueOnce({ id: SECTION }) // requireClassAccess: holds the section
      .mockResolvedValueOnce(null); // canReadClassNotes: not the class teacher
    txMock.timetableSlot.findFirst.mockResolvedValue(null); // no slot for MATHS specifically
    txMock.substitution.findFirst.mockResolvedValue(null);

    await expect(
      svc.addNote(SCHOOL, USER, 'TEACHER', { classSectionId: SECTION, subjectId: MATHS, date: DATE, body: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(txMock.classNote.create).not.toHaveBeenCalled();
  });

  it('toggles a to-do', async () => {
    txMock.classTodo.findFirst.mockResolvedValue({
      id: 't1', classSectionId: SECTION, subjectId: MATHS, date: new Date(DATE),
    });
    txMock.classTodo.update.mockResolvedValue({ id: 't1', body: 'x', done: true, createdAt: new Date(), authorTeacherId: TID });

    const out = await svc.setTodoDone(SCHOOL, USER, 'TEACHER', 't1', true);

    expect(out.done).toBe(true);
    expect(txMock.classTodo.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { done: true } }),
    );
  });

  it('setTodoDone resolves the subject from the stored row, not from any caller-supplied value', async () => {
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });
    // The stored row is History. `setTodoDone`'s signature never accepts a
    // subjectId from the caller at all — the only way the read-check can even
    // learn the subject is by reading it off this row.
    txMock.classTodo.findFirst.mockResolvedValue({
      id: 't1', classSectionId: SECTION, subjectId: HISTORY, date: new Date(DATE),
    });
    txMock.classSection.findFirst
      .mockResolvedValueOnce({ id: SECTION }) // requireClassAccess (write gate): holds the section
      .mockResolvedValueOnce(null); // canReadClassNotes: not the class teacher
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.timetableSlot.findFirst.mockResolvedValue({ id: 'slot-history' });
    txMock.classTodo.update.mockResolvedValue({ id: 't1', body: 'x', done: true, createdAt: new Date(), authorTeacherId: TID });

    await svc.setTodoDone(SCHOOL, USER, 'TEACHER', 't1', true);

    expect(txMock.timetableSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ subjectId: HISTORY }) }),
    );
  });

  it('404s toggling a to-do that does not exist in this tenant', async () => {
    txMock.classTodo.findFirst.mockResolvedValue(null);
    await expect(svc.setTodoDone(SCHOOL, USER, 'TEACHER', 'nope', true)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an empty note body', async () => {
    await expect(
      svc.addNote(SCHOOL, USER, 'TEACHER', { classSectionId: SECTION, subjectId: MATHS, date: DATE, body: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
