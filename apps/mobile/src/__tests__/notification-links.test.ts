import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeFor } from '@/lib/notification-links';

/**
 * WHERE A LEAVE-DESK NOTICE OPENS, for a teacher. A cover notice used to open
 * Requests, which lists no covers; covers live on the day they fall on, which
 * the Timetable tab reads from /my-day. The web's bell sends the same notice
 * to its own my-day screen (Today), so the two agree.
 */
const row = (kind: string) => ({ id: 'n1', kind, title: 't', body: 'b', readAt: null, createdAt: '2026-10-15T04:00:00.000Z', linkType: 'timetable', linkId: 'x' }) as never;
const screenFile = (href: string) => resolve(__dirname, '..', 'app', `${href.replace(/^\//, '')}.tsx`);

describe('a teacher\'s leave-desk notices', () => {
  it('a cover (one period, or a summary of several) opens the Timetable tab, where covers are shown', () => {
    expect(routeFor('(staff)', row('COVER_ASSIGNED'))).toBe('/(staff)/(tabs)/timetable');
    expect(existsSync(screenFile('/(staff)/(tabs)/timetable'))).toBe(true);
  });

  it('their own leave decision still opens Requests', () => {
    expect(routeFor('(staff)', row('LEAVE_DECIDED'))).toBe('/(staff)/(tabs)/home/requests');
    expect(existsSync(screenFile('/(staff)/(tabs)/home/requests'))).toBe(true);
  });
});
