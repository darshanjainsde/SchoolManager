import { requireClassAccess } from './class-access';

const tx = () => ({
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
});

const DATE = '2026-08-03';

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
