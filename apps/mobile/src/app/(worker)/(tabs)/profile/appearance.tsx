import { Card, Screen } from '@/components/ui';
import { AppearanceSetting } from '@/components/AppearanceSetting';

export default function WorkerAppearance() {
  return (
    <Screen>
      <Card style={{ paddingVertical: 2 }}>
        <AppearanceSetting />
      </Card>
    </Screen>
  );
}
