import { PortalTabBar, type PortalTabBarProps, type TabSpec } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/family-nav';

/**
 * Custom family tab bar: thin wrapper binding the shared `PortalTabBar` to
 * the family's tabs — Home, Attendance, (Fees), Results, Profile. The layout
 * passes the list for THIS school (`visibleTabs(features)`); the default is
 * the four every school has. See `StaffTabBar` for the staff-portal twin.
 */
export type FamilyTabBarProps = Omit<PortalTabBarProps, 'tabs'> & { tabs?: readonly TabSpec[] };

export function FamilyTabBar({ tabs = VISIBLE_TABS, ...props }: FamilyTabBarProps) {
  return <PortalTabBar {...props} tabs={tabs} />;
}
