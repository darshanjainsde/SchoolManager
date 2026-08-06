import { PortalTabBar, type PortalTabBarProps } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/family-nav';

/**
 * Custom family tab bar: thin wrapper binding the shared `PortalTabBar` to
 * family-nav's four core tabs — Home, Attendance, Results, Profile — with
 * the central chevron FAB that lifts the tools drawer
 * bar. Profile replaced Notices in the bar; Notices lives
 * in the drawer. See `PortalTabBar` for the behaviour and `StaffTabBar` for
 * the staff-portal twin.
 */
export type FamilyTabBarProps = Omit<PortalTabBarProps, 'tabs'>;

export function FamilyTabBar(props: FamilyTabBarProps) {
  return <PortalTabBar {...props} tabs={VISIBLE_TABS} />;
}
