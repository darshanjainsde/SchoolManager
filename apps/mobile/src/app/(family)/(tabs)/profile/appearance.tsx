import { Card, Screen } from '@/components/ui';
import { AppearanceSetting } from '@/components/AppearanceSetting';

/** The family twin of the staff Appearance door — see that file. */
export default function FamilyAppearance() {
  return (
    <Screen>
      <Card style={{ paddingVertical: 2 }}>
        <AppearanceSetting />
      </Card>
    </Screen>
  );
}
