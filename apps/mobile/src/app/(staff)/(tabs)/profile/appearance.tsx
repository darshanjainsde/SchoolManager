import { Card, Screen } from '@/components/ui';
import { AppearanceSetting } from '@/components/AppearanceSetting';

/**
 * The Appearance door (pitch №7): the same `AppearanceSetting` card that
 * used to sit unfolded on the Profile page, re-housed on its own pushed
 * screen. The chip header ("Appearance") comes from the positional rule.
 */
export default function StaffAppearance() {
  return (
    <Screen>
      <Card style={{ paddingVertical: 2 }}>
        <AppearanceSetting />
      </Card>
    </Screen>
  );
}
