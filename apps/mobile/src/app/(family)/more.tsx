import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

function MoreRow({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, paddingHorizontal: 10 }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: tokens.color.indigo50,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{label}</Text>
      <Text style={{ fontSize: 16, color: tokens.color.sub }}>›</Text>
    </Pressable>
  );
}

export default function More() {
  return (
    <Screen>
      <SectionTitle title="More" />
      <Card style={{ padding: 4 }}>
        <MoreRow label="Holidays" icon="📅" onPress={() => router.push('/(family)/holidays')} />
      </Card>
    </Screen>
  );
}
