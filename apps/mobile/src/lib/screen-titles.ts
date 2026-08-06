/**
 * Pitch №5 §3 — which screens get the back chip header, and what the chip's
 * serif title says.
 *
 * The rule is positional, not per-screen: inside a portal's `home` stack,
 * everything deeper than the index is a pushed tool and shows the way back;
 * the tab screens and the home index never do (the bar itself is their
 * navigation). The one route outside the stacks is the carved-out register —
 * full-screen by design, so the chip is its only visible exit besides Save.
 *
 * Titles are the nav's own labels (staff-nav / family-nav), so the word on
 * the chip header is the word the user tapped to get there. Dynamic segments
 * (`[threadId]`, `[examId]`…) fall back to their parent's word — the thread
 * screen introduces its participants in its own identity card, the header
 * only needs to say what shelf of the app you are on.
 */
const TITLES: Record<string, string> = {
  assignments: 'Assignments',
  class: 'Class',
  diary: 'Diary',
  holidays: 'Holidays',
  messages: 'Messages',
  notes: 'Notes',
  notices: 'Notices',
  notifications: 'Notifications',
  post: 'Announcements',
  requests: 'Requests',
  results: 'Results',
  shelf: 'Shelf',
  take: 'Attendance',
  tests: 'Tests & Results',
  timetable: 'Timetable',
};

/** True when the current route is a pushed screen that must show the chip. */
export function isPushedRoute(segments: string[]): boolean {
  if (segments[2] === 'home' && segments.length > 3) return true;
  return segments[1] === 'take';
}

/** The chip header's title — nearest named segment, walking outward. */
export function titleForSegments(segments: string[]): string {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const s = segments[i];
    if (s.startsWith('[') || s.startsWith('(') || s === 'home') continue;
    const title = TITLES[s];
    if (title) return title;
  }
  return '';
}
