import 'reflect-metadata';

const txMock = {
  enquiry: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  enquiryNote: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
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
import { ApiError } from '../../common/errors/api-error';
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

/** The code and status an ApiError carried, or {} when the call succeeded. */
async function refusal(p: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await p;
    return {};
  } catch (e) {
    const err = e as ApiError;
    return { code: (err.getResponse() as { code?: string }).code, status: err.getStatus() };
  }
}

const at = (status: string, extra: Record<string, unknown> = {}) =>
  txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status, lostReason: null, ownerUserId: null, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'NEW', lostReason: null });
  txMock.enquiry.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: LEAD, schoolId: SCHOOL, status: 'NEW', lostReason: null, ...data }),
  );
  txMock.enquiry.updateMany.mockResolvedValue({ count: 1 });
  txMock.enquiryNote.create.mockResolvedValue({ id: 'n1' });
  txMock.enquiryNote.count.mockResolvedValue(0);
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
    expect(txMock.enquiry.updateMany).toHaveBeenCalled();
    expect(txMock.enquiryNote.create).toHaveBeenCalled();
  });

  it('says nothing when the stage did not actually change', async () => {
    txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'CONTACTED', lostReason: null });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('records the reason on the history line when a lead is lost', async () => {
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
    await service().update(SCHOOL, LEAD, { status, lostReason: 'Chose another school' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ followUpAt: null }) }),
    );
  });

  it('leaves the callback alone for a stage that is still open', async () => {
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    const { data } = txMock.enquiry.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('followUpAt');
  });
});

describe('the reason belongs to being lost', () => {
  it('drops a stale reason when the lead is revived', async () => {
    txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status: 'LOST', lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(
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

  it('a typed note bumps the lead itself, scoped to the school, in the same transaction', async () => {
    const before = Date.now();
    await service().addNote(SCHOOL, LEAD, 'Asked about the bus', { userId: USER });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledTimes(1);
    const arg = txMock.enquiry.updateMany.mock.calls[0][0] as { where: unknown; data: { updatedAt: Date } };
    expect(arg.where).toEqual({ id: LEAD, schoolId: SCHOOL });
    expect(arg.data.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(withTenantMock).toHaveBeenCalledTimes(1);
  });

  it('a refused (blank) note does not touch the lead', async () => {
    await refusal(service().addNote(SCHOOL, LEAD, '  '));
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
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

describe('a lead only moves forward', () => {
  it('refuses a step backwards with 409 ENQUIRY_STAGE_BACKWARDS, and writes nothing', async () => {
    at('VISITED');
    expect(await refusal(service().update(SCHOOL, LEAD, { status: 'CONTACTED' }))).toEqual({ code: 'ENQUIRY_STAGE_BACKWARDS', status: 409 });
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('takes INTERESTED between Contacted and Visited', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'INTERESTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', body: 'Moved to Interested' }),
    }));
  });

  it('lets an enrolled family be marked lost — a family can still withdraw', async () => {
    at('ENROLLED');
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Moved city' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalled();
  });

  it('reopens a lost lead to Contacted, clears the reason, and says who', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONTACTED', lostReason: null }),
    }));
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', body: 'Reopened — back to Contacted', authorName: 'Sunita Kale' }),
    }));
  });

  it('will not reopen a lost lead straight to Visited', async () => {
    at('LOST');
    expect((await refusal(service().update(SCHOOL, LEAD, { status: 'VISITED' }))).code).toBe('ENQUIRY_STAGE_BACKWARDS');
  });

  it('never writes the retired CLOSED', async () => {
    at('NEW');
    expect((await refusal(service().update(SCHOOL, LEAD, { status: 'CLOSED' }))).status).toBe(409);
  });

  it('names the field on the refusal, so the desk can point at it', async () => {
    at('VISITED');
    await expect(service().update(SCHOOL, LEAD, { status: 'CONTACTED' })).rejects.toMatchObject({
      response: expect.objectContaining({ field: 'status' }),
    });
  });

  it('treats the same stage as a no-op: no write of a STAGE note', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('who may own a lead', () => {
  it('refuses somebody who is not on the desk, with 400 ENQUIRY_OWNER_NOT_DESK', async () => {
    at('NEW');
    expect(await refusal(service().update(SCHOOL, LEAD, { ownerUserId: OFFICER }, { userId: USER, name: 'x' })))
      .toEqual({ code: 'ENQUIRY_OWNER_NOT_DESK', status: 400 });
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
  });

  it('accepts an admissions officer of THIS school', async () => {
    at('NEW');
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    await service().update(SCHOOL, LEAD, { ownerUserId: OFFICER }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, userId: OFFICER, role: 'ADMISSIONS', isActive: true },
      select: { id: true },
    });
    expect(txMock.enquiry.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerUserId: OFFICER }),
    }));
  });

  /**
   * The owner left last month. Changing the callback date sends the whole
   * row's owner back unchanged — re-checking it would make the lead
   * uneditable until somebody reassigns it.
   */
  it('does not re-check an owner who is not being changed', async () => {
    at('CONTACTED', { ownerUserId: GONE });
    await service().update(SCHOOL, LEAD, { ownerUserId: GONE, followUpAt: '2026-10-09' }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).toHaveBeenCalled();
  });

  it('clearing the owner needs no check', async () => {
    at('CONTACTED', { ownerUserId: OFFICER });
    await service().update(SCHOOL, LEAD, { ownerUserId: null }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });
});

describe('every history line says who wrote it', () => {
  it('names a member of staff from their staff record', async () => {
    txMock.staff.findFirst.mockResolvedValue({ firstName: 'Sunita', lastName: 'Kale' });
    await service().addNote(SCHOOL, LEAD, 'Asked about the bus', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'NOTE', authorUserId: USER, authorName: 'Sunita Kale' }),
    }));
  });

  it('names an admin from the name on their profile', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: 'Mrs Rathore', role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Spoke to the father', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'Mrs Rathore' }),
    }));
  });

  it('calls an admin who never typed a name "School admin" rather than nobody', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: null, role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Left a message', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'School admin' }),
    }));
  });

  it('signs a STAGE line the controller left unnamed, from the staff record', async () => {
    at('NEW');
    txMock.staff.findFirst.mockResolvedValue({ firstName: 'Sunita', lastName: 'Kale' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' }, { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', authorUserId: USER, authorName: 'Sunita Kale' }),
    }));
  });
});

describe('the lead panel reads the same shape as the list', () => {
  beforeEach(() => {
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
    txMock.user.findMany.mockResolvedValue([]);
    txMock.enquiryNote.findMany.mockResolvedValue([
      { id: 'n1', kind: 'NOTE' }, { id: 'n2', kind: 'STAGE' }, { id: 'n3', kind: 'NOTE' },
    ]);
    // Counted the way list() counts: NOTE lines only.
    txMock.enquiryNote.count.mockResolvedValue(2);
  });

  it('says ownerOnDesk and noteCount for an owner who is on the desk', async () => {
    at('CONTACTED', { ownerUserId: OFFICER });
    const lead = await service().detail(SCHOOL, LEAD);
    expect(lead.ownerOnDesk).toBe(true);
    expect(lead.noteCount).toBe(2);
    expect(txMock.enquiryNote.count).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, enquiryId: LEAD, kind: 'NOTE' } });
  });

  it('says ownerOnDesk false for an owner who has left the desk, and keeps their name', async () => {
    // GONE is not an active officer (the desk query), but the name lookup by user id still finds them.
    at('CONTACTED', { ownerUserId: GONE });
    await service().update(SCHOOL, LEAD, { ownerUserId: GONE, followUpAt: '2026-10-09' }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).toHaveBeenCalled();
  });

  it('clearing the owner needs no check', async () => {
    at('CONTACTED', { ownerUserId: OFFICER });
    await service().update(SCHOOL, LEAD, { ownerUserId: null }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });
});

describe('every history line says who wrote it', () => {
  it('names a member of staff from their staff record', async () => {
    txMock.staff.findFirst.mockResolvedValue({ firstName: 'Sunita', lastName: 'Kale' });
    await service().addNote(SCHOOL, LEAD, 'Asked about the bus', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'NOTE', authorUserId: USER, authorName: 'Sunita Kale' }),
    }));
  });

  it('names an admin from the name on their profile', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: 'Mrs Rathore', role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Spoke to the father', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'Mrs Rathore' }),
    }));
  });

  it('calls an admin who never typed a name "School admin" rather than nobody', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: null, role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Left a message', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'School admin' }),
    }));
  });

  it('signs a STAGE line the controller left unnamed, from the staff record', async () => {
    at('NEW');
    txMock.staff.findFirst.mockResolvedValue({ firstName: 'Sunita', lastName: 'Kale' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' }, { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', authorUserId: USER, authorName: 'Sunita Kale' }),
    }));
  });
});

describe('the lead panel reads the same shape as the list', () => {
  beforeEach(() => {
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
    txMock.user.findMany.mockResolvedValue([]);
    txMock.enquiryNote.findMany.mockResolvedValue([
      { id: 'n1', kind: 'NOTE' }, { id: 'n2', kind: 'STAGE' }, { id: 'n3', kind: 'NOTE' },
    ]);
    // Counted the way list() counts: NOTE lines only.
    txMock.enquiryNote.count.mockResolvedValue(2);
  });

  it('says ownerOnDesk and noteCount for an owner who is on the desk', async () => {
    at('CONTACTED', { ownerUserId: OFFICER });
    const lead = await service().detail(SCHOOL, LEAD);
    expect(lead.ownerOnDesk).toBe(true);
    expect(lead.noteCount).toBe(2);
    expect(txMock.enquiryNote.count).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, enquiryId: LEAD, kind: 'NOTE' } });
  });

  it('says ownerOnDesk false for an owner who has left the desk, and keeps their name', async () => {
    txMock.staff.findMany.mockImplementation(({ where }: { where: { role?: string } }) =>
      Promise.resolve(
        where.role === 'ADMISSIONS'
          ? [{ userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' }]
          : [{ userId: GONE, firstName: 'Ravi', lastName: 'Old' }],
      ),
    );
    // GONE is no longer an active officer: only the name lookup (by user id) still finds them.
    txMock.staff.findMany.mockImplementation(({ where }: { where: { role?: string; isActive?: boolean } }) =>
      Promise.resolve(
        where.role === 'ADMISSIONS'
          ? [{ userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' }]
          : [{ userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' }, { userId: GONE, firstName: 'Ravi', lastName: 'Old' }],
      ),
    );
    at('CONTACTED', { ownerUserId: GONE });
    const lead = await service().detail(SCHOOL, LEAD);
    expect(lead.ownerOnDesk).toBe(false);
    expect(lead.ownerName).toBe('Ravi Old');
    expect(lead.noteCount).toBe(2);
  });

  it('says ownerOnDesk false when nobody owns it', async () => {
    at('NEW', { ownerUserId: null });
    expect((await service().detail(SCHOOL, LEAD)).ownerOnDesk).toBe(false);
  });
});

describe('an admin who owns a lead has a name on it', () => {
  beforeEach(() => {
    txMock.staff.findMany.mockResolvedValue([]); // an admin has no Staff row
    txMock.user.findMany.mockImplementation(({ where }: { where: { id?: { in: string[] }; role?: string } }) =>
      Promise.resolve(
        where.role === 'SCHOOL_ADMIN'
          ? [{ id: ADMIN, name: 'Mrs Rathore', email: 'office@school.test' }]
          : [{ id: ADMIN, name: null, role: 'SCHOOL_ADMIN' }],
      ),
    );
  });

  it('list falls back to "School admin" for an admin with no typed name, and keeps ownerOnDesk', async () => {
    txMock.enquiry.findMany.mockResolvedValue([{ id: 'a', ownerUserId: ADMIN }]);
    txMock.enquiryNote.groupBy.mockResolvedValue([]);
    const rows = await service().list(SCHOOL);
    expect(rows.map((r) => [r.id, r.ownerOnDesk, r.ownerName])).toEqual([['a', true, 'School admin']]);
  });

  it('detail names the admin owner the same way', async () => {
    at('NEW', { ownerUserId: ADMIN });
    txMock.enquiryNote.findMany.mockResolvedValue([]);
    const lead = await service().detail(SCHOOL, LEAD);
    expect(lead.ownerName).toBe('School admin');
  });

  it('uses the name on the admin profile when there is one', async () => {
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN, name: 'Mrs Rathore', role: 'SCHOOL_ADMIN', email: 'office@school.test' }]);
    txMock.enquiry.findMany.mockResolvedValue([{ id: 'a', ownerUserId: ADMIN }]);
    txMock.enquiryNote.groupBy.mockResolvedValue([]);
    const rows = await service().list(SCHOOL);
    expect(rows[0].ownerName).toBe('Mrs Rathore');
  });
});

describe('two desks moving the same lead at once', () => {
  it('writes the stage only if the lead is still where we read it', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'VISITED' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: LEAD, schoolId: SCHOOL, status: 'CONTACTED' },
    }));
    expect(txMock.enquiryNote.create).toHaveBeenCalledTimes(1);
  });

  it('refuses with 409 ENQUIRY_CHANGED and writes no history line when somebody got there first', async () => {
    at('CONTACTED');
    txMock.enquiry.updateMany.mockResolvedValue({ count: 0 });
    expect(await refusal(service().update(SCHOOL, LEAD, { status: 'INTERESTED' }))).toEqual({ code: 'ENQUIRY_CHANGED', status: 409 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('keeps a plain update when the stage is not changing', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { followUpAt: '2026-10-09' });
    expect(txMock.enquiry.update).toHaveBeenCalled();
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
  });
});

describe('an edit that does not move the stage never writes it', () => {
  it('leaves status out of the data when the request only echoes the current stage', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED', followUpAt: '2026-10-09' });
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
    const { data } = txMock.enquiry.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('status');
    expect(data.followUpAt).toEqual(new Date('2026-10-09'));
  });

  it('writes a lost reason only while the lead is still LOST (updateMany where status LOST)', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Chose another school' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: LEAD, schoolId: SCHOOL, status: 'LOST' },
    }));
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    const { data } = txMock.enquiry.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('status');
  });

  it('refuses a reason edit with 409 ENQUIRY_CHANGED when somebody reopened the lead meanwhile', async () => {
    at('LOST', { lostReason: 'Too far' });
    txMock.enquiry.updateMany.mockResolvedValue({ count: 0 });
    expect(await refusal(service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Chose another school' })))
      .toEqual({ code: 'ENQUIRY_CHANGED', status: 409 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('lost needs a reason', () => {
  it.each([undefined, null, '', '   '])('refuses LOST with reason %p, 400, before any write', async (lostReason) => {
    at('CONTACTED');
    expect(await refusal(service().update(SCHOOL, LEAD, { status: 'LOST', lostReason }))).toEqual({ code: 'ENQUIRY_LOST_REASON_REQUIRED', status: 400 });
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('stores the trimmed reason', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: '  Too far  ' });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: 'Marked Lost — Too far' }),
    }));
  });

  it('does not wipe the reason of a lost lead with a blank one', async () => {
    at('LOST', { lostReason: 'Too far' });
    expect((await refusal(service().update(SCHOOL, LEAD, { lostReason: '  ' }))).code).toBe('ENQUIRY_LOST_REASON_REQUIRED');
  });

  it('writes a history line when a lost lead gets a different reason, signed', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Chose another school' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', body: 'Lost reason changed — Chose another school', authorName: 'Sunita Kale' }),
    }));
  });

  it('says nothing when the reason is unchanged', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Too far' });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('the retired CLOSED and an unnamed actor', () => {
  it('says CLOSED is retired, not that the lead only moves forward', async () => {
    at('NEW');
    await expect(service().update(SCHOOL, LEAD, { status: 'CLOSED' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ENQUIRY_STAGE_BACKWARDS',
        message: 'Closed is no longer used — mark the lead Lost instead.',
        field: 'status',
      }),
    });
  });

  it('signs nobody, without crashing, when the actor has no user id', async () => {
    await service().addNote(SCHOOL, LEAD, 'Walk-in', {});
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorUserId: null, authorName: null }),
    }));
  });
});

const writtenNotes = () =>
  txMock.enquiryNote.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);
/**
 * What the lead row was told to become. Both paths are updateMany scoped by
 * schoolId; a stage move also carries the stage it read (compare-and-set).
 */
const updateData = () => {
  const call = txMock.enquiry.updateMany.mock.calls[0];
  return (call[0] as { data: Record<string, unknown> }).data;
};

describe('logging a call, a WhatsApp or a visit', () => {
  it('stamps lastContactedAt and moves a NEW lead to Contacted', async () => {
    at('NEW');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'CONTACTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(writtenNotes()).toEqual([
      expect.objectContaining({ kind: 'CALL', body: 'Called', authorUserId: USER, authorName: 'Sunita Kale' }),
      expect.objectContaining({ kind: 'STAGE', body: 'Moved to Contacted', authorName: 'Sunita Kale' }),
    ]);
    expect(updateData().status).toBe('CONTACTED');
    expect(updateData().lastContactedAt).toBeInstanceOf(Date);
  });

  it('a call nobody answered is logged and stamped, and does NOT mark the family contacted', async () => {
    at('NEW');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'NO_ANSWER' });
    expect(updateData()).not.toHaveProperty('status');
    expect(updateData().lastContactedAt).toBeInstanceOf(Date);
    expect(writtenNotes()).toEqual([expect.objectContaining({ kind: 'CALL', body: 'Called — no answer' })]);
  });

  it('Interested on WhatsApp moves Contacted forward to Interested', async () => {
    at('CONTACTED');
    await service().logContact(SCHOOL, LEAD, 'WHATSAPP', { outcome: 'INTERESTED' });
    expect(updateData().status).toBe('INTERESTED');
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ kind: 'WHATSAPP', body: 'Messaged on WhatsApp — interested' }));
  });

  it('never drags a lead backwards — Interested on a Visited lead changes no stage', async () => {
    at('VISITED');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'INTERESTED' });
    expect(updateData()).not.toHaveProperty('status');
    expect(writtenNotes()).toHaveLength(1);
  });

  it('Lost from a call carries the reason and clears the callback', async () => {
    at('INTERESTED');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'LOST', lostReason: 'Fees too high' });
    expect(updateData()).toEqual(expect.objectContaining({ status: 'LOST', lostReason: 'Fees too high', followUpAt: null }));
    expect(writtenNotes()[1]).toEqual(expect.objectContaining({ kind: 'STAGE', body: 'Marked Lost — Fees too high' }));
  });

  it.each([undefined, null, '', '   '])('Lost with reason %p is refused 400 ENQUIRY_LOST_REASON_REQUIRED and writes nothing', async (lostReason) => {
    at('INTERESTED');
    expect(await refusal(service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'LOST', lostReason })))
      .toEqual({ code: 'ENQUIRY_LOST_REASON_REQUIRED', status: 400 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
  });

  it('names the field on the lost-reason refusal', async () => {
    at('INTERESTED');
    await expect(service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'LOST' })).rejects.toMatchObject({
      response: expect.objectContaining({ field: 'lostReason' }),
    });
  });

  it('Lost on a lead that is already lost needs no new reason and moves nothing', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'LOST' });
    expect(updateData()).not.toHaveProperty('status');
    expect(writtenNotes()).toHaveLength(1);
  });

  it('the stage move is a compare-and-set on the stage it read', async () => {
    at('NEW');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'CONTACTED' });
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: LEAD, schoolId: SCHOOL, status: 'NEW' },
    }));
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
  });

  it('a contact logged against a lead another officer just moved is 409 ENQUIRY_CHANGED, with no history line', async () => {
    at('NEW');
    txMock.enquiry.updateMany.mockResolvedValue({ count: 0 });
    expect(await refusal(service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'CONTACTED' })))
      .toEqual({ code: 'ENQUIRY_CHANGED', status: 409 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('a contact that moves no stage never writes the stage, and its write still carries schoolId', async () => {
    at('CONTACTED');
    await service().logContact(SCHOOL, LEAD, 'VISIT');
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    expect(txMock.enquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: LEAD, schoolId: SCHOOL } }));
    expect(updateData()).not.toHaveProperty('status');
  });

  it('adds what the officer typed to the history line', async () => {
    at('CONTACTED');
    await service().logContact(SCHOOL, LEAD, 'VISIT', { body: ' saw the labs ' });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ kind: 'VISIT', body: 'Visited the school: saw the labs' }));
  });

  it('a lead from another school is not found, and nothing is written', async () => {
    txMock.enquiry.findFirst.mockResolvedValue(null);
    await expect(service().logContact(SCHOOL, LEAD, 'CALL')).rejects.toBeInstanceOf(NotFoundException);
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
  });

  it('a typed note cannot be blank', async () => {
    at('NEW');
    expect(await refusal(service().addNote(SCHOOL, LEAD, '   '))).toEqual({ code: 'VALIDATION', status: 400 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('a walk-in typed at the desk', () => {
  beforeEach(() => {
    txMock.enquiry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: LEAD, ...data }));
  });

  it('is owned by whoever typed it, carries its source, and opens its own history', async () => {
    await service().create(
      SCHOOL,
      { parentName: ' Meera Purohit ', phone: '98290 11223', source: 'WALK_IN', childName: 'Aarav', gradeInterest: 'Class III', whatsappOk: true },
      { userId: USER, name: 'Sunita Kale', role: 'STAFF' },
    );
    expect(txMock.enquiry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: SCHOOL, parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN',
        childName: 'Aarav', gradeInterest: 'Class III', whatsappOk: true, ownerUserId: USER, status: 'NEW',
      }),
    });
    expect(writtenNotes()).toEqual([
      expect.objectContaining({ kind: 'SYSTEM', body: 'Walk-in enquiry taken by Sunita Kale — asked about Class III', authorUserId: USER }),
    ]);
  });

  it('is left unowned when a school admin types it, so it shows in the officers’ Unowned view', async () => {
    await service().create(
      SCHOOL,
      { parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN' },
      { userId: ADMIN, name: 'Principal Rathore', role: 'SCHOOL_ADMIN' },
    );
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerUserId: null }) });
    // The history still says who took it.
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ body: 'Walk-in enquiry taken by Principal Rathore', authorUserId: ADMIN }));
  });

  it('a phone enquiry says so, and an unticked WhatsApp box stays false', async () => {
    await service().create(SCHOOL, { parentName: 'Imran Shaikh', phone: '98290 44556', source: 'PHONE' }, { userId: USER, name: 'Sunita Kale', role: 'STAFF' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'PHONE', whatsappOk: false, childName: null }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ body: 'Phone enquiry taken by Sunita Kale' }));
  });
});

describe('the website form', () => {
  const site = { get: () => ({ kind: 'tenant', schoolId: SCHOOL }), requireTenant: () => ({ schoolId: SCHOOL }) } as never;
  const withEnquiry = { getFeatures: jest.fn().mockResolvedValue(new Set(['ENQUIRY'])) } as never;

  beforeEach(() => {
    txMock.enquiry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: LEAD, ...data }));
  });

  it('records WEBSITE when the form says nothing — unchanged for every existing caller', async () => {
    await new EnquiryService(site, withEnquiry).submit({ parentName: 'Sneha Kulkarni', phone: '98123 00011', gradeInterest: 'Nursery' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'WEBSITE', status: 'NEW' }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ kind: 'SYSTEM', body: 'Enquiry received from the website — asked about Nursery' }));
  });

  it('trims the name and the phone, as the desk does', async () => {
    await new EnquiryService(site, withEnquiry).submit({ parentName: '  Sneha Kulkarni ', phone: ' 98123 00011  ' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ parentName: 'Sneha Kulkarni', phone: '98123 00011' }) });
  });

  it('records COURSE_CARD for a call-back asked for on a course card', async () => {
    await new EnquiryService(site, withEnquiry).submit({ parentName: 'Course card lead', phone: '98123 00011', gradeInterest: 'Nursery', source: 'COURSE_CARD' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'COURSE_CARD' }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ body: 'Call-back requested from a course card — asked about Nursery' }));
  });
});
