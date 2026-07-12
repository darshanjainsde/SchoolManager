import { eventsVisibleSince } from './public-events.service';

describe('eventsVisibleSince', () => {
  it('returns the start of the current UTC day, not the current instant', () => {
    // Regression: a NETWORK event approved for "today 1:55 PM" vanished from
    // every school at 1:55 PM sharp because the filter compared against now().
    // Events must stay listed through the end of their day.
    const now = new Date('2026-07-12T08:36:02Z'); // 2:06 PM IST
    const cutoff = eventsVisibleSince(now);
    expect(cutoff.toISOString()).toBe('2026-07-12T00:00:00.000Z');

    const eventEnd = new Date('2026-07-12T08:25:00Z'); // ended 11 min "ago"
    expect(eventEnd.getTime()).toBeGreaterThanOrEqual(cutoff.getTime()); // still visible
  });

  it('hides events from previous days', () => {
    const cutoff = eventsVisibleSince(new Date('2026-07-12T08:36:02Z'));
    expect(new Date('2026-07-11T23:59:00Z').getTime()).toBeLessThan(cutoff.getTime());
  });
});
