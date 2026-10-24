import { ApiError } from '../../common/errors/api-error';
import { OWNER_MOVES, assertOwnerMove, autoCloseDue, canConfirm, canReopen, isUnanswered, lookInActive } from './support-status';

const days = (n: number, from = new Date('2026-10-24T10:00:00Z')) => new Date(from.getTime() - n * 86_400_000);
const NOW = new Date('2026-10-24T10:00:00Z');

describe('the owner moves', () => {
  it('walks the happy path', () => {
    expect(() => assertOwnerMove('OPEN', 'ACKNOWLEDGED')).not.toThrow();
    expect(() => assertOwnerMove('ACKNOWLEDGED', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertOwnerMove('IN_PROGRESS', 'WAITING_ON_SCHOOL')).not.toThrow();
    expect(() => assertOwnerMove('WAITING_ON_SCHOOL', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertOwnerMove('IN_PROGRESS', 'RESOLVED')).not.toThrow();
    expect(() => assertOwnerMove('RESOLVED', 'CLOSED')).not.toThrow();
  });

  it('lets the owner pull a resolved ticket back, but never reopen a closed one', () => {
    expect(() => assertOwnerMove('RESOLVED', 'IN_PROGRESS')).not.toThrow();
    expect(OWNER_MOVES.CLOSED).toEqual([]);
    try { assertOwnerMove('CLOSED', 'IN_PROGRESS'); throw new Error('did not throw'); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect(((e as ApiError).getResponse() as { code: string }).code).toBe('SUPPORT_ILLEGAL_MOVE'); expect((e as ApiError).getStatus()).toBe(409); }
  });

  it('refuses backwards hops and no-ops', () => {
    expect(() => assertOwnerMove('WAITING_ON_SCHOOL', 'ACKNOWLEDGED')).toThrow(ApiError);
    expect(() => assertOwnerMove('IN_PROGRESS', 'OPEN')).toThrow(ApiError);
    expect(() => assertOwnerMove('OPEN', 'OPEN')).toThrow(ApiError);
    expect(() => assertOwnerMove('OPEN', 'CLOSED')).toThrow(ApiError);
  });
});

describe('the school moves', () => {
  it('may reopen inside 14 days of resolution, resolved or already closed', () => {
    expect(canReopen('RESOLVED', days(13), NOW)).toBe(true);
    expect(canReopen('CLOSED', days(13), NOW)).toBe(true);
    expect(canReopen('RESOLVED', days(15), NOW)).toBe(false);
    expect(canReopen('OPEN', null, NOW)).toBe(false);
    expect(canReopen('IN_PROGRESS', days(1), NOW)).toBe(false);
  });

  it('may confirm only what the owner has resolved', () => {
    expect(canConfirm('RESOLVED')).toBe(true);
    expect(canConfirm('CLOSED')).toBe(false);
    expect(canConfirm('OPEN')).toBe(false);
  });
});

describe('the clocks', () => {
  it('unanswered = the school moved last, and only while the ticket is live', () => {
    expect(isUnanswered({ status: 'OPEN', lastSchoolActivityAt: days(1), lastOwnerActivityAt: null })).toBe(true);
    expect(isUnanswered({ status: 'IN_PROGRESS', lastSchoolActivityAt: days(1), lastOwnerActivityAt: days(2) })).toBe(true);
    expect(isUnanswered({ status: 'IN_PROGRESS', lastSchoolActivityAt: days(2), lastOwnerActivityAt: days(1) })).toBe(false);
    expect(isUnanswered({ status: 'RESOLVED', lastSchoolActivityAt: days(1), lastOwnerActivityAt: null })).toBe(false);
    expect(isUnanswered({ status: 'CLOSED', lastSchoolActivityAt: days(1), lastOwnerActivityAt: null })).toBe(false);
  });

  it('auto-close falls due after 7 quiet days, not before', () => {
    expect(autoCloseDue(days(6), NOW)).toBe(false);
    expect(autoCloseDue(days(8), NOW)).toBe(true);
    expect(autoCloseDue(null, NOW)).toBe(false);
  });

  it('look-in consent is live only while its clock is in the future', () => {
    expect(lookInActive(null, NOW)).toBe(false);
    expect(lookInActive(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(true);
    expect(lookInActive(new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });
});
