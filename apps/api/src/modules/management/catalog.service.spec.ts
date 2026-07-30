import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const txMock = {
  period: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  school: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

// Keep the real `Prisma` export (prisma-errors.ts's isP2025/isP2002/isP2003 rely
// on `instanceof Prisma.PrismaClientKnownRequestError`); only `withTenant` itself
// is stubbed so no real DB connection is ever attempted.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { CatalogService } from './catalog.service';
import { UpdateClassNoteVisibilityDto, UpdateWorkingDaysDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PERIOD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('CatalogService.updatePeriod', () => {
  const svc = new CatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  it('persists a BREAK kind change alongside the other fields', async () => {
    txMock.period.update.mockResolvedValue({
      id: PERIOD,
      label: 'Lunch',
      order: 4,
      startTime: '12:30',
      endTime: '13:15',
      kind: 'BREAK',
    });

    const result = await svc.updatePeriod(SCHOOL, PERIOD, {
      label: 'Lunch',
      startTime: '12:30',
      endTime: '13:15',
      kind: 'BREAK',
    });

    expect(txMock.period.update).toHaveBeenCalledWith({
      where: { id: PERIOD },
      data: { label: 'Lunch', startTime: '12:30', endTime: '13:15', kind: 'BREAK' },
    });
    expect(result.kind).toBe('BREAK');
  });

  it('defaults kind to undefined (unchanged) when not supplied, leaving CLASS periods as-is', async () => {
    txMock.period.update.mockResolvedValue({
      id: PERIOD,
      label: 'Period 1',
      order: 1,
      startTime: '08:00',
      endTime: '08:45',
      kind: 'CLASS',
    });

    await svc.updatePeriod(SCHOOL, PERIOD, { label: 'Period 1' });

    expect(txMock.period.update).toHaveBeenCalledWith({
      where: { id: PERIOD },
      data: { label: 'Period 1' },
    });
  });

  it('throws NotFoundException when the period does not belong to this school (P2025)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Prisma } = jest.requireActual('@skoolos/db');
    const p2025 = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    txMock.period.update.mockRejectedValue(p2025);

    await expect(svc.updatePeriod(SCHOOL, PERIOD, { label: 'Ghost' })).rejects.toThrow(
      'Period not found',
    );
  });
});

describe('CatalogService working days', () => {
  const svc = new CatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  it('getWorkingDays returns the school-scoped array as-is', async () => {
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5] });

    const result = await svc.getWorkingDays(SCHOOL);

    expect(txMock.school.findUnique).toHaveBeenCalledWith({
      where: { id: SCHOOL },
      select: { workingDays: true },
    });
    expect(result).toEqual({ workingDays: [1, 2, 3, 4, 5] });
  });

  it('updateWorkingDays dedupes and sorts before persisting', async () => {
    txMock.school.update.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });

    await svc.updateWorkingDays(SCHOOL, [5, 1, 3, 1, 6, 2, 4, 4]);

    expect(txMock.school.update).toHaveBeenCalledWith({
      where: { id: SCHOOL },
      data: { workingDays: [1, 2, 3, 4, 5, 6] },
    });
  });

  it('updateWorkingDays sorts a single out-of-order pair', async () => {
    txMock.school.update.mockResolvedValue({ workingDays: [6, 7] });

    await svc.updateWorkingDays(SCHOOL, [7, 6]);

    expect(txMock.school.update).toHaveBeenCalledWith({
      where: { id: SCHOOL },
      data: { workingDays: [6, 7] },
    });
  });
});

describe('CatalogService class note visibility', () => {
  const svc = new CatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  it('getClassNoteVisibility returns the school-scoped setting as-is', async () => {
    txMock.school.findUnique.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });

    const result = await svc.getClassNoteVisibility(SCHOOL);

    expect(txMock.school.findUnique).toHaveBeenCalledWith({
      where: { id: SCHOOL },
      select: { classNoteVisibility: true },
    });
    expect(result).toEqual({ classNoteVisibility: 'SUBJECT_TEACHERS' });
  });

  it('updateClassNoteVisibility persists the new value', async () => {
    txMock.school.update.mockResolvedValue({ classNoteVisibility: 'SUBJECT_TEACHERS' });

    const result = await svc.updateClassNoteVisibility(SCHOOL, 'SUBJECT_TEACHERS');

    expect(txMock.school.update).toHaveBeenCalledWith({
      where: { id: SCHOOL },
      data: { classNoteVisibility: 'SUBJECT_TEACHERS' },
    });
    expect(result).toEqual({ classNoteVisibility: 'SUBJECT_TEACHERS' });
  });
});

describe('UpdateClassNoteVisibilityDto validation', () => {
  it('accepts ALL_TEACHERS', async () => {
    const dto = plainToInstance(UpdateClassNoteVisibilityDto, { classNoteVisibility: 'ALL_TEACHERS' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts SUBJECT_TEACHERS', async () => {
    const dto = plainToInstance(UpdateClassNoteVisibilityDto, { classNoteVisibility: 'SUBJECT_TEACHERS' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects any other value', async () => {
    const dto = plainToInstance(UpdateClassNoteVisibilityDto, { classNoteVisibility: 'SOMETHING_ELSE' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'classNoteVisibility')).toBe(true);
  });
});

describe('UpdateWorkingDaysDto validation', () => {
  it('accepts a valid in-range array', async () => {
    const dto = plainToInstance(UpdateWorkingDaysDto, { workingDays: [1, 2, 3, 4, 5] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a day below 1', async () => {
    const dto = plainToInstance(UpdateWorkingDaysDto, { workingDays: [0, 1, 2] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'workingDays')).toBe(true);
  });

  it('rejects a day above 7', async () => {
    const dto = plainToInstance(UpdateWorkingDaysDto, { workingDays: [1, 8] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'workingDays')).toBe(true);
  });

  it('rejects a non-integer entry', async () => {
    const dto = plainToInstance(UpdateWorkingDaysDto, { workingDays: [1, 2.5] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'workingDays')).toBe(true);
  });

  it('rejects more than 7 entries', async () => {
    const dto = plainToInstance(UpdateWorkingDaysDto, { workingDays: [1, 2, 3, 4, 5, 6, 7, 1] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'workingDays')).toBe(true);
  });
});
