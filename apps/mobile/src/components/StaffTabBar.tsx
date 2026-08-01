import { PortalTabBar, type PortalTabBarProps } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/staff-nav';

/**
 * Custom teacher tab bar (pitch: Phone 3): thin wrapper binding the shared
 * `PortalTabBar` to staff-nav's four core tabs — Today, Attendance,
 * Timetable, Announcements — with the central chevron FAB that lifts the
 * tools drawer. See `PortalTabBar` for the behaviour and `FamilyTabBar` for
 * the family-portal twin.
 */
export type StaffTabBarProps = Omit<PortalTabBarProps, 'tabs'>;

export function StaffTabBar(props: StaffTabBarProps) {
  return <PortalTabBar {...props} tabs={VISIBLE_TABS} />;
}
