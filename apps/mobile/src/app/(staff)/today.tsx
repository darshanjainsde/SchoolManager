import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function Today() {
  return (
    <Screen>
      <SectionTitle title="Today" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
