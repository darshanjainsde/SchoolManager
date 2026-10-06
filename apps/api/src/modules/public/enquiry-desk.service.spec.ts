import 'reflect-metadata';

const txMock = {
  enquiry: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), create: jest.fn() },
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
    expect(txMock.enquiry.updateMany).not.toHaveBeenCalled();
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
