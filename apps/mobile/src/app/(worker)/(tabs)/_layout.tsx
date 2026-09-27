import { Tabs } from 'expo-router';
import { WorkerTabBar, type WorkerTabBarProps } from '@/components/WorkerTabBar';
import { ALL_TABS, homeTabFor, jobFor, tabsFor } from '@/lib/worker-nav';
import { useSession } from '@/lib/use-session';

/**
 * ONE PORTAL, THREE DESKS. The session's staff job picks the tab set; every
 * other tab stays declared (expo-router needs the screen) but hidden with
 * `href: null`, so a sports teacher never sees "Counter" and a librarian
 * never sees "Meets". Until the session has loaded the bar draws the general
 * pair, which is also what an older session (no `staffRole`) gets.
 */
export default function WorkerTabsLayout() {
  const session = useSession();
  const job = jobFor(session);
  // Session, not job: an accounts officer's Pay tab depends on the SALARY
  // override as well as the job, and only the session knows both.
  const tabs = tabsFor(session);
  const visible = new Set(tabs.map((t) => t.name));
  return (
    <Tabs
      key={`${job}:${tabs.length}`}
      initialRouteName={homeTabFor(session)}
      backBehavior="history"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <WorkerTabBar
          tabs={tabs}
          state={props.state}
          navigation={props.navigation as unknown as WorkerTabBarProps['navigation']}
          insets={props.insets}
        />
      )}
    >
      {ALL_TABS.map(({ name, title }) => (
        <Tabs.Screen key={name} name={name} options={{ title, href: visible.has(name) ? undefined : null }} />
      ))}
    </Tabs>
  );
}
