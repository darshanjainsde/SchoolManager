import { PortalTabBar, type PortalTabBarProps } from '@/components/PortalTabBar';
import { VISIBLE_TABS } from '@/lib/family-nav';
import { hasFeature, useFeatures } from '@/lib/use-features';

/**
 * Custom family tab bar: thin wrapper binding the shared `PortalTabBar` to
 * family-nav's core tabs — Home, Attendance, Library, Results, Profile —
 * with the central chevron FAB that lifts the tools drawer
 * bar. Profile replaced Notices in the bar; Notices lives
 * in the drawer. See `PortalTabBar` for the behaviour and `StaffTabBar` for
 * the staff-portal twin.
 *
 * Library is plan-gated: hidden until /auth/me confirms the school's plan
 * carries the LIBRARY feature — hidden-until-known, so a school without a
 * library never sees the tab flash (the route stays registered; the API
 * would refuse it anyway).
 */
export type FamilyTabBarProps = Omit<PortalTabBarProps, 'tabs'>;

export function FamilyTabBar(props: FamilyTabBarProps) {
  const features = useFeatures();
  const tabs = VISIBLE_TABS.filter((t) => t.name !== 'library' || hasFeature(features, 'LIBRARY'));
  return <PortalTabBar {...props} tabs={tabs} />;
}
