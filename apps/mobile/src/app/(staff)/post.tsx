import { Text } from 'react-native';
import { Card, Screen, SectionTitle } from '@/components/ui';

export default function Post() {
  return (
    <Screen>
      <SectionTitle title="Post" />
      <Card><Text>Coming in this build.</Text></Card>
    </Screen>
  );
}
