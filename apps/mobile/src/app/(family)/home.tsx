import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function Home() {
  return (
    <Screen>
      <SectionTitle title="Home" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
