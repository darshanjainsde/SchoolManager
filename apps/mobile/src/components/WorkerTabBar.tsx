import { PortalTabBar, type PortalTabBarProps } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/worker-nav';

/**
 * The non-teaching staff bar — the same chrome the teacher and the family
 * see. It used to be expo-router's stock bar, so this role opened what
 * looked like a different product (UI audit 2026-09-22, #5).
 */
export type WorkerTabBarProps = Omit<PortalTabBarProps, 'tabs'>;

export function WorkerTabBar(props: WorkerTabBarProps) {
  return <PortalTabBar {...props} tabs={VISIBLE_TABS} />;
}
