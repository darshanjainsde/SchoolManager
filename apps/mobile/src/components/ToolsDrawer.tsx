import { PortalToolsDrawer } from '@/components/PortalToolsDrawer';
import { MORE_ITEMS } from '@/lib/staff-nav';

/**
 * Staff bottom-sheet tools drawer (pitch: Phone 3): thin wrapper binding the
 * shared `PortalToolsDrawer` to staff-nav's `MORE_ITEMS`, with live badge
 * counts on Messages (unread) and Requests (pending). See
 * `PortalToolsDrawer` for the scrim/sheet/animation/logout behaviour and
 * `FamilyToolsDrawer` for the family-portal twin.
 */
const BADGE_ENDPOINTS = {
  '/(staff)/messages': '/manage/messages/unread-count',
  '/(staff)/requests': '/manage/requests/pending-count',
} as const;

export function ToolsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <PortalToolsDrawer open={open} onClose={onClose} items={MORE_ITEMS} badgeEndpoints={BADGE_ENDPOINTS} />
  );
}
