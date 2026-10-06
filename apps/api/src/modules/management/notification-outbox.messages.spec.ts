import type { NotificationOutboxKind } from '@skoolos/types';
import { NOTIFICATION_OUTBOX_KINDS } from '@skoolos/types';
import { OUTBOX_EMAIL, toNotificationMessage } from './notification-outbox.service';
import { FIXTURES } from './notification-outbox.fixtures';

describe('toNotificationMessage', () => {
  it.each(NOTIFICATION_OUTBOX_KINDS.map((k) => [k]))('%s renders without "undefined" anywhere', (kind) => {
    const msg = toNotificationMessage(kind as NotificationOutboxKind, FIXTURES[kind as NotificationOutboxKind], 'Mon 6 Oct');
    expect(JSON.stringify(msg)).not.toMatch(/undefined/);
    // JSON.stringify silently DROPS keys whose value is undefined — the exact
    // sports bug (`title: undefined`) would pass the line above. Check the keys.
    expect(Object.entries(msg.payload).filter(([, v]) => v === undefined).map(([k]) => k)).toEqual([]);
  });

  it('a sports notice keeps its own title and body, under the Sports desk', () => {
    const msg = toNotificationMessage('SPORTS_NOTICE', FIXTURES.SPORTS_NOTICE, 'Mon 6 Oct');
    expect(msg).toEqual({ kind: 'ANNOUNCEMENT', payload: { schoolName: '', title: '100 m U-11: Final', body: '14.2 s · 1st — champion!', className: 'Sports', postedOn: 'Mon 6 Oct' } });
  });

  it('an unknown kind is refused, never rendered as an assignment', () => {
    expect(() => toNotificationMessage('NOPE' as NotificationOutboxKind, {}, 'x')).toThrow(/NOPE/);
  });

  it('a fee-due row with its term and date becomes the FEE topic; an older row without them stays general', () => {
    const S = 'Raffles Public School';
    const withTerm = toNotificationMessage('FEE_DUE', { schoolName: S, title: 't', body: 'b', termName: 'Term 2', dueOn: 'Mon 13 Oct 2026' }, 'x');
    expect(withTerm.kind === 'ANNOUNCEMENT' && withTerm.payload.topic).toEqual({ kind: 'FEE', term: 'Term 2', dueOn: 'Mon 13 Oct 2026' });
    const old = toNotificationMessage('FEE_DUE', { schoolName: S, title: 't', body: 'b' }, 'x');
    expect(old.kind === 'ANNOUNCEMENT' && old.payload.topic).toBeFalsy();
  });

  it('the three leave-desk notices keep their own kind and words — no ANNOUNCEMENT overloading', () => {
    for (const kind of ['LEAVE_CANCELLED', 'COVER_CANCELLED', 'COVER_UNFILLED'] as const) {
      expect(toNotificationMessage(kind, FIXTURES[kind], 'x')).toEqual({ kind, payload: FIXTURES[kind] });
    }
  });

  it('every one of the three is emailed by the drain (none has a writer that sends its own letter)', () => {
    for (const kind of ['LEAVE_CANCELLED', 'COVER_CANCELLED', 'COVER_UNFILLED'] as const) expect(OUTBOX_EMAIL[kind]).toBe(true);
  });
});
