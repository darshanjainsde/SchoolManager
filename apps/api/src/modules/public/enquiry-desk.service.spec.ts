import 'reflect-metadata';

const txMock = {
  enquiry: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  enquiryNote: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  staff: { findMany: jest.fn(), findFirst: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => ({}),
}));

import { NotFoundException } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';

/**
 * "CONTACTED" USED TO BE A CLAIM NOBODY COULD CHECK.
 *
 * The three-state model recorded a status and nothing else — no note, no date,
 * no author. These rules are what turn that into a history a school can be
 * asked about six months later, so each of them is worth pinning.
 */

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OFFICER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const GONE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ADMIN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as never;
const features = { getFeatures: jest.fn() } as never;

function service() {
  return new EnquiryService(tenant, features);
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'NEW', lostReason: null });
  txMock.enquiry.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: LEAD, schoolId: SCHOOL, status: 'NEW', lostReason: null, ...data }),
  );
  txMock.enquiryNote.create.mockResolvedValue({ id: 'n1' });
  txMock.staff.findFirst.mockResolvedValue(null);
  txMock.staff.findMany.mockResolvedValue([]);
  txMock.user.findFirst.mockResolvedValue(null);
  txMock.user.findMany.mockResolvedValue([]);
});

describe('moving a lead through the pipeline', () => {
  it('writes a history line for the stage change', async () => {
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' }, { userId: USER, name: 'Sunita Kale' });

    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schoolId: SCHOOL, enquiryId: LEAD, kind: 'STAGE',
          body: 'Moved to Contacted', authorUserId: USER, authorName: 'Sunita Kale',
        }),
      }),
    );
  });

  /**
   * The audit line and the update share one transaction. A history that can be
   * missing for a change that succeeded is worse than none at all: it makes the
   * record look complete when it is not.
   */
  it('writes the note inside the same transaction as the update', async () => {
    await service().update(SCHOOL, LEAD, { status: 'VISITED' });
    expect(withTenantMock).toHaveBeenCalledTimes(1);
    expect(txMock.enquiry.update).toHaveBeenCalled();
    expect(txMock.enquiryNote.create).toHaveBeenCalled();
  });

  it('says nothing when the stage did not actually change', async () => {
    txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'CONTACTED', lostReason: null });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('records the reason on the history line when a lead is lost', async () => {
    txMock.enquiry.update.mockResolvedValue({ id: LEAD, status: 'LOST', lostReason: 'Chose another school' });
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Chose another school' });

    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: 'Marked Lost — Chose another school' }) }),
    );
  });
});

describe('a finished lead has no next step', () => {
  /**
   * A callback on an enrolled family is a reminder to ring somebody about
   * nothing — and it would sit in the overdue count forever.
   */
  it.each(['ENROLLED', 'LOST'] as const)('clears the callback when the lead reaches %s', async (status) => {
    await service().update(SCHOOL, LEAD, { status });
    expect(txMock.enquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ followUpAt: null }) }),
    );
  });

  it('leaves the callback alone for a stage that is still open', async () => {
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    const { data } = txMock.enquiry.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('followUpAt');
  });
});

describe('the reason belongs to being lost', () => {
  it('drops a stale reason when the lead is revived', async () => {
    txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'LOST', lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    expect(txMock.enquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lostReason: null }) }),
    );
  });
});

describe('setting a callback date', () => {
  it('stores a date, and null clears it', async () => {
    await service().update(SCHOOL, LEAD, { followUpAt: '2026-09-10' });
    expect((txMock.enquiry.update.mock.calls[0][0] as { data: { followUpAt: Date } }).data.followUpAt)
      .toEqual(new Date('2026-09-10'));

    jest.clearAllMocks();
    txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'NEW', lostReason: null });
    txMock.enquiry.update.mockResolvedValue({ id: LEAD });
    await service().update(SCHOOL, LEAD, { followUpAt: null });
    expect((txMock.enquiry.update.mock.calls[0][0] as { data: Record<string, unknown> }).data.followUpAt).toBeNull();
  });
});

describe('a lead from another school', () => {
  it('is not found, rather than updated', async () => {
    txMock.enquiry.findFirst.mockResolvedValue(null);
    await expect(service().update(SCHOOL, LEAD, { status: 'CONTACTED' })).rejects.toBeInstanceOf(NotFoundException);
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
  });

  it('cannot have a note attached to it', async () => {
    txMock.enquiry.findFirst.mockResolvedValue(null);
    await expect(service().addNote(SCHOOL, LEAD, 'hello')).rejects.toBeInstanceOf(NotFoundException);
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('who sits at the desk', () => {
  beforeEach(() => {
    // Officers are asked for by role; owner names for the list are asked for by user id.
    txMock.staff.findMany.mockImplementation(({ where }: { where: { role?: string } }) =>
      Promise.resolve(
        where.role === 'ADMISSIONS'
          ? [{ userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' }]
          : [
              { userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' },
              { userId: GONE, firstName: 'Ravi', lastName: 'Old' },
            ],
      ),
    );
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN, name: null, email: 'office@school.test' }]);
  });

  it('is the active admissions officers, then the school admins', async () => {
    expect(await service().owners(SCHOOL)).toEqual([
      { userId: OFFICER, name: 'Sunita Kale', job: 'ADMISSIONS' },
      { userId: ADMIN, name: 'office@school.test', job: 'ADMIN' },
    ]);
    expect(txMock.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, role: 'ADMISSIONS', isActive: true, userId: { not: null } },
    }));
    expect(txMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, role: 'SCHOOL_ADMIN', isActive: true },
    }));
  });

  /**
   * An officer who leaves keeps their name on the history, but their open
   * leads are nobody's now — the desk lists them under Unowned.
   */
  it("marks a lead whose owner has left the desk, and keeps that owner's name on it", async () => {
    txMock.enquiry.findMany.mockResolvedValue([
      { id: 'a', ownerUserId: OFFICER },
      { id: 'b', ownerUserId: GONE },
      { id: 'c', ownerUserId: null },
    ]);
    txMock.enquiryNote.groupBy.mockResolvedValue([]);
    const rows = await service().list(SCHOOL);
    expect(rows.map((r) => [r.id, r.ownerOnDesk, r.ownerName])).toEqual([
      ['a', true, 'Sunita Kale'],
      ['b', false, 'Ravi Old'],
      ['c', false, null],
    ]);
  });
});
