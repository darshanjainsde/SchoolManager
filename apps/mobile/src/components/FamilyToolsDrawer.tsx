import { PortalToolsDrawer } from '@/components/PortalToolsDrawer';
import { MORE_ITEMS } from '@/lib/family-nav';

/**
 * Family bottom-sheet tools drawer: thin wrapper binding the shared
 * `PortalToolsDrawer` to family-nav's `MORE_ITEMS`, with a live badge count
 * on Messages (unread). Notices has no count endpoint, so it carries no
 * badge. See `PortalToolsDrawer` for the scrim/sheet/animation/logout
 * behaviour and `ToolsDrawer` for the staff-portal twin.
 */
const BADGE_ENDPOINTS = {
  '/(family)/messages': '/me/messages/unread-count',
} as const;

export function FamilyToolsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <PortalToolsDrawer open={open} onClose={onClose} items={MORE_ITEMS} badgeEndpoints={BADGE_ENDPOINTS} />
  );
}
