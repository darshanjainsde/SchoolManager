import type { Href } from 'expo-router';
import type { NotificationRow } from '@skoolos/types';

/**
 * Everything two notification surfaces have to agree on: the icon a kind
 * wears, where a row deep-links, and how its timestamp reads.
 *
 * There are two surfaces now — the standalone notification centre
 * (`components/NotificationsScreen.tsx`, still a registered route in both
 * portals) and a tapped push notification. They must never disagree about
 * where a row goes, so the mapping lives here rather than being duplicated (a
 * copy would drift the first time a new `kind` shipped).
 */

export type NotificationGroup = '(family)' | '(staff)';

/**
 * Drawn duotone glyph (components/icons.tsx) per notification kind — pitch №4
 * replaced the emoji map: emoji render differently on every Android vendor
 * and cannot take the theme's ink colour. Callers fall back to 'notices' for
 * a kind shipped after this map.
 */
export const KIND_ICON: Record<string, string> = {
  MESSAGE: 'messages',
  EXAM: 'results',
  RESULT: 'results',
  ASSIGNMENT: 'assignments',
  ANNOUNCEMENT: 'notices',
  REQUEST_DECISION: 'requests',
  DIARY: 'diary',
  ATTENDANCE: 'take',
  // The app has no library screen yet, so this falls through to the notices
  // glyph's neighbourhood rather than inventing one — see the mobile library
  // tab task.
  LIBRARY: 'assignments',
};

/**
 * Where a tapped notification deep-links, resolved BY ROLE (the same
 * linkType/linkId maps to that role's own route). A kind with no sensible target
 * for this role returns null — the row still marks read, it just doesn't
 * navigate. `thread` links carry the id; the kind-based fallbacks land on the
 * list screen for that kind.
 */
export function routeFor(group: NotificationGroup, n: NotificationRow): Href | null {
  if (n.linkType === 'thread' && n.linkId)
    return `/${group}/(tabs)/home/messages/${n.linkId}` as Href;
  if (group === '(family)') {
    switch (n.kind) {
      case 'ASSIGNMENT':
        return '/(family)/(tabs)/home/assignments';
      case 'RESULT':
        return '/(family)/results';
      case 'EXAM':
        return '/(family)/(tabs)/home';
      case 'ANNOUNCEMENT':
        return '/(family)/(tabs)/home/notices';
      case 'DIARY':
        return '/(family)/(tabs)/home/diary';
      case 'ATTENDANCE':
        return '/(family)/attendance';
      default:
        return null;
    }
  }
  // staff
  if (n.kind === 'REQUEST_DECISION') return '/(staff)/(tabs)/home/requests';
  if (n.kind === 'DIARY') return '/(staff)/(tabs)/home/diary';
  return null;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
