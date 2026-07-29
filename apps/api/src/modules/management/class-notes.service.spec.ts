const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
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

describe('ClassNotesService', () => {
  const svc = new ClassNotesService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.substitution.findFirst.mockResolvedValue(null);
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

    const out = await svc.list(SCHOOL, SECTION, DATE);

    expect(out.notes).toHaveLength(1);
    expect(out.todos).toHaveLength(1);
    expect(txMock.classNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classSectionId: SECTION, date: new Date(DATE) } }),
    );
  });

  it('rejects a malformed date', async () => {
    await expect(svc.list(SCHOOL, SECTION, '3-8-2026')).rejects.toMatchObject({ status: 400 });
  });

  it('adds a note attributed to the calling teacher', async () => {
    txMock.classNote.create.mockResolvedValue({ id: 'n2', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await svc.addNote(SCHOOL, USER, { classSectionId: SECTION, date: DATE, body: 'x' });

    expect(txMock.classNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorTeacherId: TID, classSectionId: SECTION, body: 'x' }),
      }),
    );
  });

  it('refuses to write a note for a class the teacher does not hold', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);

    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: 'sec-other', date: DATE, body: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(txMock.classNote.create).not.toHaveBeenCalled();
  });

  it('lets a substitute write a note for the day they are covering', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    txMock.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });
    txMock.classNote.create.mockResolvedValue({ id: 'n3', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: 'sec-9a', date: DATE, body: 'x' }),
    ).resolves.toBeDefined();
  });

  it('toggles a to-do', async () => {
    txMock.classTodo.findFirst.mockResolvedValue({ id: 't1', classSectionId: SECTION, date: new Date(DATE) });
    txMock.classTodo.update.mockResolvedValue({ id: 't1', body: 'x', done: true, createdAt: new Date(), authorTeacherId: TID });

    const out = await svc.setTodoDone(SCHOOL, USER, 't1', true);

    expect(out.done).toBe(true);
    expect(txMock.classTodo.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { done: true } }),
    );
  });

  it('404s toggling a to-do that does not exist in this tenant', async () => {
    txMock.classTodo.findFirst.mockResolvedValue(null);
    await expect(svc.setTodoDone(SCHOOL, USER, 'nope', true)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an empty note body', async () => {
    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: SECTION, date: DATE, body: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
