import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function Notices() {
  return (
    <Screen>
      <SectionTitle title="Notices" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
