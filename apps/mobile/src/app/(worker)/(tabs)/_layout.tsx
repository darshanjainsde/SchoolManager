import { Tabs } from 'expo-router';
import { WorkerTabBar, type WorkerTabBarProps } from '@/components/WorkerTabBar';
import { VISIBLE_TABS } from '@/lib/worker-nav';

export default function WorkerTabsLayout() {
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <WorkerTabBar
          state={props.state}
          navigation={props.navigation as unknown as WorkerTabBarProps['navigation']}
          insets={props.insets}
        />
      )}
    >
      {VISIBLE_TABS.map(({ name, title }) => (
        <Tabs.Screen key={name} name={name} options={{ title }} />
      ))}
    </Tabs>
  );
}
