import { PortalTabBar, type PortalTabBarProps, type TabSpec } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/worker-nav';

/**
 * The non-teaching staff bar — the same chrome the teacher and the family
 * see. It used to be expo-router's stock bar, so this role opened what
 * looked like a different product (UI audit 2026-09-22, #5). Which tabs it
 * draws is the job's business (`lib/worker-nav.ts`); the layout passes them.
 */
export type WorkerTabBarProps = Omit<PortalTabBarProps, 'tabs'> & { tabs?: readonly TabSpec[] };

export function WorkerTabBar({ tabs = VISIBLE_TABS, ...props }: WorkerTabBarProps) {
  return <PortalTabBar {...props} tabs={tabs} />;
}
