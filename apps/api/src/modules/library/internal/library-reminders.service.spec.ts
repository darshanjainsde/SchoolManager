import { shouldRemind } from './library-reminders.service';

/**
 * The cadence IS the policy, so it gets its own test.
 *
 * A reminder that arrives every morning about the same book is one nobody
 * reads by the third day — and a muted channel cannot be unmuted by sending
 * more. So the rule is: a child hears on day 1 and then weekly; a teacher only
 * weekly. That difference is deliberate politics, not an oversight, and this
 * file exists so a later "make it daily, they'll return it faster" change has
 * to argue with something.
 */
describe('shouldRemind — who hears about a late book, and how often', () => {
  it('says nothing before a book is actually late', () => {
    for (const days of [-5, -1, 0]) {
      expect(shouldRemind(days, 'STUDENT')).toBe(false);
      expect(shouldRemind(days, 'TEACHER')).toBe(false);
    }
  });

  it('tells a child the day after it was due, then leaves them alone until day 7', () => {
    expect(shouldRemind(1, 'STUDENT')).toBe(true);
    for (const quiet of [2, 3, 4, 5, 6]) {
      expect(shouldRemind(quiet, 'STUDENT')).toBe(false);
    }
    expect(shouldRemind(7, 'STUDENT')).toBe(true);
    expect(shouldRemind(14, 'STUDENT')).toBe(true);
  });

  it('does NOT chase a teacher on day one — a colleague is not a defaulter', () => {
    expect(shouldRemind(1, 'TEACHER')).toBe(false);
    for (const quiet of [2, 3, 4, 5, 6]) {
      expect(shouldRemind(quiet, 'TEACHER')).toBe(false);
    }
    expect(shouldRemind(7, 'TEACHER')).toBe(true);
    expect(shouldRemind(21, 'TEACHER')).toBe(true);
  });

  it('never fires more than once a week once a book is long overdue', () => {
    // The failure this guards is a month-late book generating thirty
    // notifications, which is how a family stops reading anything the school
    // sends — including the ones that matter.
    const fired = [];
    for (let d = 1; d <= 30; d += 1) if (shouldRemind(d, 'STUDENT')) fired.push(d);
    expect(fired).toEqual([1, 7, 14, 21, 28]);
  });
});
