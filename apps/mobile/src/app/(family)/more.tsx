import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { AppearanceSetting } from '@/components/AppearanceSetting';
import { api } from '@/lib/api';
import { session } from '@/lib/session';
import { useTokens } from '@/theme/theme-context';

function MoreRow({
  label,
  icon,
  onPress,
  destructive,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  /** Red-tinted styling for a destructive action (e.g. logout), no trailing chevron. */
  destructive?: boolean;
}) {
  const tokens = useTokens();
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
          backgroundColor: destructive ? tokens.color.red50 : tokens.color.indigo50,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: '600',
          color: destructive ? tokens.color.red : tokens.color.ink,
        }}
      >
        {label}
      </Text>
      {!destructive && <Text style={{ fontSize: 16, color: tokens.color.sub }}>›</Text>}
    </Pressable>
  );
}

/**
 * Revokes the refresh token server-side first (best-effort — see
 * `api.logout`, which swallows network failures so an offline/lost device
 * still signs out locally), then clears the persisted session and returns to
 * the school-connect screen — not `/(auth)/login`, since a tester switching
 * roles/schools for the closed test needs to be able to re-pick a school
 * host too, not just re-enter credentials for the same one.
 */
async function logout() {
  await api.logout();
  await session.clear();
  router.replace('/(auth)/connect');
}

export default function More() {
  return (
    <Screen>
      <SectionTitle title="More" />
      <Card style={{ padding: 4 }}>
        <MoreRow label="Holidays" icon="📅" onPress={() => router.push('/(family)/holidays')} />
      </Card>
      <Card style={{ padding: 4 }}>
        <AppearanceSetting />
      </Card>
      <Card style={{ padding: 4 }}>
        <MoreRow label="Log out" icon="🚪" destructive onPress={logout} />
      </Card>
    </Screen>
  );
}
