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
    // SAME findMany fixture the tests already set, so "counts SEATS, not rows"
    // still proves what it says rather than trusting a hand-written total.
    aggregate: jest.fn(),
  },
  student: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';

/**
 * THE FRONT DOOR.
 *
 * The registration engine shipped with no way in: every route into it was an
 * authenticated admin one, so the desk sat empty and nobody could sign up. This
 * is the public door, and it is deliberately narrower than the admin one.
 *
 * It goes through the SAME register() path so capacity and the waitlist cannot
 * behave one way for a parent and another way for the office. What it does not
 * do is trust the caller: a stranger on the internet may not claim to be a
 * student, may not file a registration against another school, and may not open
 * a door onto an event this school does not host.
 */

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TICKET = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as never;
const svc = new RegistrationsService(tenant);

const GUEST = { guestName: 'Priya Nair', guestEmail: 'priya@example.com', guestPhone: '9876543210' };

beforeEach(() => {
  jest.clearAllMocks();
  txMock.event.findFirst.mockResolvedValue({ id: EVENT, schoolId: SCHOOL, status: 'APPROVED', scope: 'SCHOOL' });
  txMock.eventTicketType.findFirst.mockResolvedValue({
    id: TICKET,
    eventId: EVENT,
    priceMinor: 0,
    currency: 'INR',
    capacity: null,
    salesOpenAt: null,
    salesCloseAt: null,
  });
  txMock.eventRegistration.findMany.mockResolvedValue([]);
  txMock.eventRegistration.aggregate.mockImplementation(async () => {
    const rows = (await txMock.eventRegistration.findMany()) as { quantity: number }[];
    return { _sum: { quantity: rows.reduce((n, r) => n + r.quantity, 0) || null } };
  });
  txMock.eventRegistration.count.mockResolvedValue(0);
  txMock.eventRegistration.create.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: 'reg-1',
    ...args.data,
  }));
});

describe('a stranger taking a place at a free event', () => {
  it('is confirmed, and told so in the words the page will use', async () => {
    const result = await svc.registerPublicly(EVENT, GUEST);
    expect(result).toEqual({ id: 'reg-1', status: 'CONFIRMED', waitlistPos: null, quantity: 1 });
  });

  it('files the row against this school and against nobody else', async () => {
    await svc.registerPublicly(EVENT, GUEST);
    const { data } = txMock.eventRegistration.create.mock.calls[0][0];
    expect(data).toMatchObject({
      schoolId: SCHOOL,
      guestName: 'Priya Nair',
      guestEmail: 'priya@example.com',
      studentId: null,
    });
  });

  it('takes the number of seats the family asked for', async () => {
    const result = await svc.registerPublicly(EVENT, { ...GUEST, quantity: 4 });
    expect(result.quantity).toBe(4);
    expect(txMock.eventRegistration.create.mock.calls[0][0].data.quantity).toBe(4);
  });
});

describe('what a stranger is not allowed to do', () => {
  it('cannot register for an event this school does not host', async () => {
    // A NETWORK event is readable here, so without this check the public door
    // would write into a school whose seat count RLS hides from us.
    txMock.event.findFirst.mockResolvedValue({
      id: EVENT,
      schoolId: OTHER_SCHOOL,
      status: 'APPROVED',
      scope: 'NETWORK',
    });
    await expect(svc.registerPublicly(EVENT, GUEST)).rejects.toBeInstanceOf(BadRequestException);
    expect(txMock.eventRegistration.create).not.toHaveBeenCalled();
  });

  it('cannot claim to be a student, however the request is shaped', async () => {
    await svc.registerPublicly(EVENT, { ...GUEST, studentId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } as never);
    const { data } = txMock.eventRegistration.create.mock.calls[0][0];
    expect(data.studentId).toBeNull();
  });

  it('cannot file the registration as coming from another school', async () => {
    await svc.registerPublicly(EVENT, { ...GUEST, fromSchoolId: OTHER_SCHOOL } as never);
    const { data } = txMock.eventRegistration.create.mock.calls[0][0];
    expect(data.fromSchoolId).toBe(SCHOOL);
  });

  it('cannot register for an event that is not approved yet', async () => {
    txMock.event.findFirst.mockResolvedValue({ id: EVENT, schoolId: SCHOOL, status: 'DRAFT', scope: 'SCHOOL' });
    await expect(svc.registerPublicly(EVENT, GUEST)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gets a not-found for an event that does not exist, not a silent success', async () => {
    txMock.event.findFirst.mockResolvedValue(null);
    await expect(svc.registerPublicly(EVENT, GUEST)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('when the hall is full', () => {
  it('is given a place in the queue with a number on it, not a refusal', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue({
      id: TICKET,
      eventId: EVENT,
      priceMinor: 0,
      currency: 'INR',
      capacity: 2,
      salesOpenAt: null,
      salesCloseAt: null,
    });
    txMock.eventRegistration.findMany.mockResolvedValue([{ quantity: 2 }]);
    txMock.eventRegistration.count.mockResolvedValue(3);

    const result = await svc.registerPublicly(EVENT, GUEST);
    expect(result.status).toBe('WAITLISTED');
    expect(result.waitlistPos).toBe(4);
  });
});

describe('a paid event', () => {
  it('holds the place rather than confirming it, because no money has moved', async () => {
    txMock.eventTicketType.findFirst.mockResolvedValue({
      id: TICKET,
      eventId: EVENT,
      priceMinor: 25000,
      currency: 'INR',
      capacity: null,
      salesOpenAt: null,
      salesCloseAt: null,
    });
    const result = await svc.registerPublicly(EVENT, GUEST);
    expect(result.status).toBe('HELD');
  });
});
