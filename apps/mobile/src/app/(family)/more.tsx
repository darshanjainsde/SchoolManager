import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function More() {
  return (
    <Screen>
      <SectionTitle title="More" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
