import type { Href } from 'expo-router';
import type { NotificationRow } from '@skoolos/types';

/**
 * Everything two notification surfaces have to agree on: the icon a kind
 * wears, where a row deep-links, and how its timestamp reads.
 *
 * There are two surfaces now — the standalone notification centre
 * (`components/NotificationsScreen.tsx`, still a registered route in both
 * portals) and the paper slip the bell unfolds in place
 * (`components/NotificationSlip.tsx`). They must never disagree about where a
 * tapped row goes, so the mapping lives here rather than being duplicated (a
 * copy would drift the first time a new `kind` shipped).
 */

export type NotificationGroup = '(family)' | '(staff)';

export const KIND_ICON: Record<string, string> = {
  MESSAGE: '💬',
  EXAM: '📝',
  RESULT: '📊',
  ASSIGNMENT: '📚',
  ANNOUNCEMENT: '📣',
  REQUEST_DECISION: '✅',
  DIARY: '📔',
  ATTENDANCE: '📉',
};

/**
 * Where a tapped notification deep-links, resolved BY ROLE (the same
 * linkType/linkId maps to that role's own route). A kind with no sensible target
 * for this role returns null — the row still marks read, it just doesn't
 * navigate. `thread` links carry the id; the kind-based fallbacks land on the
 * list screen for that kind.
 */
export function routeFor(group: NotificationGroup, n: NotificationRow): Href | null {
  if (n.linkType === 'thread' && n.linkId) return `/${group}/messages/${n.linkId}` as Href;
  if (group === '(family)') {
    switch (n.kind) {
      case 'ASSIGNMENT':
        return '/(family)/assignments';
      case 'RESULT':
        return '/(family)/results';
      case 'EXAM':
        return '/(family)/home';
      case 'ANNOUNCEMENT':
        return '/(family)/notices';
      case 'DIARY':
        return '/(family)/diary';
      case 'ATTENDANCE':
        return '/(family)/attendance';
      default:
        return null;
    }
  }
  // staff
  if (n.kind === 'REQUEST_DECISION') return '/(staff)/requests';
  if (n.kind === 'DIARY') return '/(staff)/diary';
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
