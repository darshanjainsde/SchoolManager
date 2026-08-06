/**
 * The salutation above the name on a portal home screen.
 *
 * Time-of-day rather than a fixed "Good day" because the home screen is opened
 * at the start of a shift, and a greeting that never changes stops being read
 * at all. Boundaries follow ordinary Indian school usage: morning until noon,
 * afternoon until 5, evening after — deliberately NOT "good night", which nobody
 * says on opening an app.
 *
 * Takes an hour so it is testable without freezing the clock; callers pass
 * `new Date().getHours()`.
 */
export function salutationFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Convenience wrapper for render code. */
export function salutation(now: Date = new Date()): string {
  return salutationFor(now.getHours());
}
