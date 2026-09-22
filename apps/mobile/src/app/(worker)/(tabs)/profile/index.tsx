import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useReload } from '@/lib/query';
import { Card, ErrorState, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { ProfileMenu } from '@/components/ProfileMenu';
import { signOut } from '@/lib/sign-out';
import { jobFor } from '@/lib/worker-nav';
import { useSession } from '@/lib/use-session';
import { hasFeature } from '@/lib/features';
import { useTokens } from '@/theme/theme-context';

/**
 * THE NON-TEACHING STAFF PROFILE — office, support, driver, helper,
 * security, and for now the librarian and the sports teacher too.
 *
 * This role had no profile screen at all, which meant no way to sign out on
 * a school's shared handset, no way to change a password, and push
 * notifications arriving with nowhere to land (UI audit 2026-09-22, #5).
 * Deliberately the same four doors and the same quiet destructive Sign out
 * as the teacher's profile: one product, three portals.
 */
const STAFF_ROLE_LABEL: Record<string, string> = {
  OFFICE: 'Office staff',
  SUPPORT: 'Support staff',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  LIBRARIAN: 'Librarian',
  SPORTS: 'Sports teacher',
  OTHER: 'Staff',
};

interface Me {
  userId: string;
  role: string;
  staffRole: string | null;
  name: string | null;
}

function confirmSignOut(): void {
  Alert.alert('Sign out?', 'This removes every profile on this phone. You can sign in again with your number.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
  ]);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function WorkerProfile() {
  const tokens = useTokens();
  const session = useSession();
  // A desk job (sports, library) lives on its desk tabs; its own attendance
  // page is reached from here instead of taking a fifth slot in the bar.
  const desk = jobFor(session) !== 'GENERAL';
  const pay = hasFeature(session, 'SALARY');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, reload] = useReload();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<Me>('/auth/me')
        .then((d) => {
          if (!cancelled) setMe(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [reloadKey]),
  );

  const name = me?.name?.trim() || '';

  return (
    <Screen onRefresh={reload}>
      <SectionTitle title="My profile" />

      {error && <ErrorState error={error} onRetry={reload} />}
      {!me && !error && <LoadingRows label="Loading your details…" rows={2} />}

      {me && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: tokens.color.indigo,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontWeight: '800', fontSize: 16 }}>
                {initials(name || 'Staff')}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text testID="worker-profile-name" style={{ fontSize: 15.5, fontWeight: '700', color: tokens.color.ink }}>
                {name || 'Your school record'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Pill tone="indigo">{STAFF_ROLE_LABEL[me.staffRole ?? 'OTHER'] ?? 'Staff'}</Pill>
              </View>
            </View>
          </View>
          <Text style={{ paddingHorizontal: 12, paddingBottom: 12, fontSize: 12, lineHeight: 17, color: tokens.color.sub }}>
            Your name and role are your school&rsquo;s record. The office changes them.
          </Text>
        </Card>
      )}

      {/* The same four doors the teacher has, so the app is one product. */}
      <ProfileMenu
        rows={[
          ...(desk ? [{ icon: 'take' as const, label: 'My attendance', route: '/(worker)/(tabs)/today', testID: 'profile-menu-attendance' }] : []),
          ...(pay ? [{ icon: 'fees' as const, label: 'My pay', route: '/(worker)/(tabs)/profile/salary', testID: 'profile-menu-salary' }] : []),
          { icon: 'palette', label: 'Appearance', route: '/(worker)/(tabs)/profile/appearance', testID: 'profile-menu-appearance' },
          { icon: 'key', label: 'Change password', route: '/(worker)/(tabs)/profile/password', testID: 'profile-menu-password' },
          { icon: 'phone', label: 'My WhatsApp number', route: '/(worker)/(tabs)/profile/phone', testID: 'profile-menu-phone' },
          { icon: 'person', label: 'Switch profile', route: '/(worker)/(tabs)/profile/switch', testID: 'profile-menu-switch' },
        ]}
      />

      {/* Sign out lives at the bottom of Profile because that is where every
          other app has taught people to look — and because before this it
          did not exist anywhere in this portal. */}
      <Pressable
        testID="profile-signout"
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={confirmSignOut}
        style={{
          marginTop: 4,
          borderWidth: 1,
          borderColor: tokens.color.red,
          borderRadius: 12,
          paddingVertical: 13,
          minHeight: 44,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: tokens.color.red, fontWeight: '700', textAlign: 'center', fontSize: 14 }}>
          Sign out
        </Text>
      </Pressable>
    </Screen>
  );
}
