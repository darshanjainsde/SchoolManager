import { PortalTabBar, type PortalTabBarProps } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/staff-nav';
import { hasFeature, useFeatures } from '@/lib/use-features';

/**
 * Custom teacher tab bar (pitch: Phone 3): thin wrapper binding the shared
 * `PortalTabBar` to staff-nav's core tabs — Today, Attendance, Timetable,
 * Library, Profile — with the central chevron FAB that lifts the tools
 * drawer. See `PortalTabBar` for the behaviour and `FamilyTabBar` for the
 * family-portal twin.
 *
 * Library is plan-gated exactly as on the family bar: hidden until /auth/me
 * confirms the LIBRARY feature — hidden-until-known, never a flash.
 */
export type StaffTabBarProps = Omit<PortalTabBarProps, 'tabs'>;

export function StaffTabBar(props: StaffTabBarProps) {
  const features = useFeatures();
  const tabs = VISIBLE_TABS.filter((t) => t.name !== 'library' || hasFeature(features, 'LIBRARY'));
  return <PortalTabBar {...props} tabs={tabs} />;
}
