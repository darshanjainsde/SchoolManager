import 'reflect-metadata';

const txMock = {
  student: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => ({}),
}));

import { NotFoundException } from '@nestjs/common';
import { PortalService } from './portal.service';

/**
 * A SIGNED-IN FAMILY IS NOT A STRANGER.
 *
 * The public door files a guest row: a name, an email, and no link to anybody
 * the school already knows. For a family that is already signed in that is a
 * worse record than the school could have had — the desk shows "Priya Nair"
 * where it could have shown the actual pupil, their class and their admission
 * number, and the school cannot tell its own families from walk-ins.
 *
 * So a signed-in join goes through `/me`, where — like every other route on
 * that controller — the pupil is resolved from the caller's own JWT and never
 * from anything the request body says.
 */

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STUDENT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EVENT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as never;
const registrations = { register: jest.fn() };

function service() {
  return new PortalService(
    tenant,
    {} as never, // timetable
    {} as never, // holidays
    {} as never, // diary
    registrations as never,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.student.findFirst.mockResolvedValue({ id: STUDENT, firstName: 'Aarav', lastName: 'Sharma' });
  registrations.register.mockResolvedValue({
    id: 'reg-1',
    status: 'CONFIRMED',
    waitlistPos: null,
    quantity: 1,
  });
});

describe('a family joining an event while signed in', () => {
  it('files the place against the pupil, not as a guest off the street', async () => {
    await service().registerForEvent(USER, EVENT, 1);
    expect(registrations.register).toHaveBeenCalledWith(
      EVENT,
      expect.objectContaining({ studentId: STUDENT, quantity: 1 }),
    );
  });

  it('resolves the pupil from the caller’s own login, never from the request', async () => {
    await service().registerForEvent(USER, EVENT, 1);
    // The lookup is by userId. No student id crosses the wire on /me/*.
    expect(txMock.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER }) }),
    );
  });

  it('books the number of seats the family asked for', async () => {
    await service().registerForEvent(USER, EVENT, 4);
    expect(registrations.register).toHaveBeenCalledWith(EVENT, expect.objectContaining({ quantity: 4 }));
  });

  it('will not register for an event another school hosts, exactly as the public door will not', async () => {
    await service().registerForEvent(USER, EVENT, 1);
    expect(registrations.register).toHaveBeenCalledWith(
      EVENT,
      expect.objectContaining({ requireHostedBy: SCHOOL }),
    );
  });

  it('hands back what the engine decided, so a full event still reads as a queue place', async () => {
    registrations.register.mockResolvedValue({ id: 'reg-9', status: 'WAITLISTED', waitlistPos: 3, quantity: 2 });
    await expect(service().registerForEvent(USER, EVENT, 2)).resolves.toEqual({
      id: 'reg-9',
      status: 'WAITLISTED',
      waitlistPos: 3,
      quantity: 2,
    });
  });

  it('tells a login with no pupil record to go through the public door instead of crashing', async () => {
    // A TEACHER or STAFF login is signed in but has no Student row.
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(service().registerForEvent(USER, EVENT, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(registrations.register).not.toHaveBeenCalled();
  });

  it('never lets a signed-in caller pass guest details that would overwrite who they are', async () => {
    await service().registerForEvent(USER, EVENT, 1);
    const [, dto] = registrations.register.mock.calls[0];
    expect(dto.guestName).toBeUndefined();
    expect(dto.guestEmail).toBeUndefined();
    expect(dto.fromSchoolId).toBe(SCHOOL);
  });
});

describe('the seat count a family may ask for', () => {
  it.each([
    [0, 1],
    [-3, 1],
    [999, 20],
  ])('clamps %s to %s, because the DTO bound is not the only door', async (asked, expected) => {
    await service().registerForEvent(USER, EVENT, asked);
    expect(registrations.register).toHaveBeenCalledWith(EVENT, expect.objectContaining({ quantity: expected }));
  });
});
