import 'reflect-metadata';

const txMock = {
  event: { findFirst: jest.fn() },
  eventTicketType: { findFirst: jest.fn(), findMany: jest.fn() },
  eventRegistration: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    // seatsTaken sums in the database now. The mock derives its answer from the
    // SAME findMany fixture each test already sets, so "counts SEATS, not rows"
    // still proves what it claims rather than trusting a hand-written total.
    aggregate: jest.fn(),
  },
  student: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { RegistrationsService } from './registrations.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TICKET = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as never;
const svc = new RegistrationsService(tenant);

function ticket(over: Partial<{ priceMinor: number; capacity: number | null; currency: string; salesOpenAt: Date | null; salesCloseAt: Date | null }> = {}) {
  return {
    id: TICKET,
    eventId: EVENT,
    priceMinor: 0,
    currency: 'INR',
    capacity: null,
    salesOpenAt: null,
    salesCloseAt: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.event.findFirst.mockResolvedValue({ id: EVENT, schoolId: SCHOOL, status: 'APPROVED' });
  txMock.eventTicketType.findFirst.mockResolvedValue(ticket());
  txMock.eventRegistration.findMany.mockResolvedValue([]);
  txMock.eventRegistration.aggregate.mockImplementation(async () => {
    const rows = (await txMock.eventRegistration.findMany()) as { quantity: number }[];
    return { _sum: { quantity: rows.reduce((n, r) => n + r.quantity, 0) || null } };
  });
  txMock.eventRegistration.count.mockResolvedValue(0);
  txMock.eventRegistration.create.mockImplementation((args: { data: unknown }) => args.data);
});

describe('registering', () => {
  it('confirms a free registration outright, with no payment expected', () => {
    // "Free" is not a separate code path — it is priceMinor 0 on the same one,
    // which is what stops the paid branch rotting until the day money matters.
    return svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' }).then((r) => {
      expect(r).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED', amountMinor: 0 });
    });
  });

  it('holds a paid registration rather than confirming it, and marks payment pending', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ priceMinor: 25000 }));
    const r = await svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ status: 'HELD', paymentStatus: 'PENDING' });
  });

  it('copies the price onto the row so a later price change cannot rewrite it', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ priceMinor: 25000, currency: 'INR' }));
    const r = await svc.register(EVENT, { quantity: 2, guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ amountMinor: 50000, currency: 'INR' });
  });

  it('files the row under the HOST school, not the caller', async () => {
    // The host owns its attendee list; that is the decision the RLS policies
    // rest on. Getting this backwards would file a network registration in the
    // wrong tenant and hide it from the school actually running the event.
    txMock.event.findFirst.mockResolvedValue({ id: EVENT, schoolId: OTHER_SCHOOL, status: 'APPROVED' });
    const r = await svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ schoolId: OTHER_SCHOOL, fromSchoolId: SCHOOL });
  });

  it('refuses an event that is not approved yet', async () => {
    txMock.event.findFirst.mockResolvedValue({ id: EVENT, schoolId: SCHOOL, status: 'PENDING' });
    await expect(svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' })).rejects.toThrow(
      /not open for registration/i,
    );
  });

  it('refuses when the event has no ticket type at all', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(null);
    await expect(svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' })).rejects.toThrow(
      /no ticket type/i,
    );
  });
});

describe('capacity and the waitlist', () => {
  it('waitlists past capacity instead of refusing, and says which place', async () => {
    // A refusal loses the person entirely; a queue position is information the
    // school can act on when somebody drops out.
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ capacity: 2 }));
    txMock.eventRegistration.findMany.mockResolvedValue([{ quantity: 1 }, { quantity: 1 }]);
    txMock.eventRegistration.count.mockResolvedValue(2);
    const r = await svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ status: 'WAITLISTED', waitlistPos: 3 });
  });

  it('counts SEATS, not rows — a family of four fills four places', async () => {
    // Counting rows would let a hall of 10 admit 10 families of four.
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ capacity: 10 }));
    txMock.eventRegistration.findMany.mockResolvedValue([{ quantity: 4 }, { quantity: 4 }]);
    const r = await svc.register(EVENT, { quantity: 4, guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ status: 'WAITLISTED' });
  });

  it('admits the party that exactly fills the last seats', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ capacity: 10 }));
    txMock.eventRegistration.findMany.mockResolvedValue([{ quantity: 8 }]);
    const r = await svc.register(EVENT, { quantity: 2, guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ status: 'CONFIRMED' });
  });

  it('ignores declined and cancelled rows when counting seats', async () => {
    // Someone who was turned down is not occupying a chair. The query filters
    // to HELD/CONFIRMED; this pins that so a widened filter cannot silently
    // make a full event look fuller.
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ capacity: 5 }));
    await svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' });
    // The seat count is a database aggregate now, so the status filter has to
    // be asserted where it actually lives. The property under test is unchanged:
    // a declined or cancelled row must not hold a seat.
    expect(txMock.eventRegistration.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['HELD', 'CONFIRMED'] } }),
        _sum: { quantity: true },
      }),
    );
  });

  it('treats a null capacity as unlimited', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(ticket({ capacity: null }));
    txMock.eventRegistration.findMany.mockResolvedValue([{ quantity: 500 }]);
    const r = await svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' });
    expect(r).toMatchObject({ status: 'CONFIRMED' });
  });

  it('respects a closed sales window', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(
      ticket({ salesCloseAt: new Date(Date.now() - 60_000) }),
    );
    await expect(svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' })).rejects.toThrow(
      /closed/i,
    );
  });

  it('respects a sales window that has not opened', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue(
      ticket({ salesOpenAt: new Date(Date.now() + 60_000) }),
    );
    await expect(svc.register(EVENT, { guestName: 'A', guestEmail: 'a@b.c' })).rejects.toThrow(
      /not opened/i,
    );
  });
});

describe('the desk', () => {
  it('counts seats rather than rows, and keeps waitlisted out of the confirmed figure', async () => {
    txMock.event.findFirst.mockResolvedValue({
      id: EVENT, schoolId: SCHOOL, title: 'Open day', startAt: new Date(), endAt: null,
      venue: 'Hall', scope: 'SCHOOL', status: 'APPROVED',
    });
    txMock.eventTicketType.findMany.mockResolvedValue([{ capacity: 100 }]);
    txMock.student.findMany.mockResolvedValue([]);
    txMock.eventRegistration.findMany.mockResolvedValue([
      { id: '1', quantity: 4, status: 'CONFIRMED', guestName: 'A', createdAt: new Date(), studentId: null, fromSchoolId: null, guestEmail: null, guestPhone: null, paymentStatus: 'NOT_REQUIRED', amountMinor: 0, currency: 'INR', waitlistPos: null, checkedInAt: null },
      { id: '2', quantity: 2, status: 'HELD', guestName: 'B', createdAt: new Date(), studentId: null, fromSchoolId: null, guestEmail: null, guestPhone: null, paymentStatus: 'PENDING', amountMinor: 500, currency: 'INR', waitlistPos: null, checkedInAt: null },
      { id: '3', quantity: 3, status: 'WAITLISTED', guestName: 'C', createdAt: new Date(), studentId: null, fromSchoolId: null, guestEmail: null, guestPhone: null, paymentStatus: 'NOT_REQUIRED', amountMinor: 0, currency: 'INR', waitlistPos: 1, checkedInAt: null },
    ]);

    const out = await svc.listForEvent(EVENT);
    expect(out.counts.confirmed).toBe(4);
    expect(out.counts.held).toBe(2);
    expect(out.counts.waitlisted).toBe(3);
    // Seats actually taking up room: confirmed + held, never waitlisted.
    expect(out.counts.seats).toBe(6);
  });

  it('names a registrant from another school rather than showing a blank row', async () => {
    // A network registration references a student this tenant cannot read.
    // "Someone from another school" is useful; an empty row is not.
    txMock.event.findFirst.mockResolvedValue({
      id: EVENT, schoolId: SCHOOL, title: 'X', startAt: new Date(), endAt: null,
      venue: null, scope: 'NETWORK', status: 'APPROVED',
    });
    txMock.eventTicketType.findMany.mockResolvedValue([]);
    txMock.student.findMany.mockResolvedValue([]);
    txMock.eventRegistration.findMany.mockResolvedValue([
      { id: '1', quantity: 1, status: 'CONFIRMED', guestName: null, studentId: 'unreadable', fromSchoolId: OTHER_SCHOOL, createdAt: new Date(), guestEmail: null, guestPhone: null, paymentStatus: 'NOT_REQUIRED', amountMinor: 0, currency: 'INR', waitlistPos: null, checkedInAt: null },
    ]);
    const out = await svc.listForEvent(EVENT);
    expect(out.registrations[0].name).toMatch(/another school/i);
    expect(out.registrations[0].fromSchoolId).toBe(OTHER_SCHOOL);
  });

  it('refuses to open an event belonging to another school', async () => {
    txMock.event.findFirst.mockResolvedValue(null);
    await expect(svc.listForEvent(EVENT)).rejects.toThrow(/not found/i);
  });
});
