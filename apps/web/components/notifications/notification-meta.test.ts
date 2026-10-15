import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeForNotification } from './notification-meta';

/**
 * A teacher's cover notice opens Today, which reads /my-day and so shows every
 * cover on the chosen day. It used to open the leave page, which lists none.
 * The app opens its own my-day screen (Timetable) for the same notice.
 */
const page = (href: string) => resolve(__dirname, '..', '..', 'app', href.replace(/^\//, ''), 'page.tsx');

describe('routeForNotification — a teacher\'s leave-desk notices', () => {
  it('a cover opens Today, where covers are listed', () => {
    expect(routeForNotification('COVER_ASSIGNED', 'teacher')).toBe('/teacher');
    expect(existsSync(page('/teacher'))).toBe(true);
  });
  it('their own leave decision still opens the leave page', () => {
    expect(routeForNotification('LEAVE_DECIDED', 'teacher')).toBe('/teacher/leave');
    expect(existsSync(page('/teacher/leave'))).toBe(true);
  });
});
