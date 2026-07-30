import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentProfile } from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** "AS" for Aarav Sharma — mirrors the web's `initials` (apps/web/app/portal/profile/page.tsx). */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
      }}
    >
      <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: tokens.color.ink }}>{value ?? '—'}</Text>
    </View>
  );
}

/**
 * Standalone, read-only mirror of the web's `/portal/profile`
 * (apps/web/app/portal/profile/page.tsx): photo (or an initials fallback),
 * name, admission no., roll no. and class. Role-neutral — this is the
 * STUDENT's own record, shown identically whether a parent or the student
 * is holding the phone (see role-neutral-copy.test.ts).
 */
export default function Profile() {
  const tokens = useTokens();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<StudentProfile>('/me/profile')
        .then((data) => {
          if (!cancelled) setProfile(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Screen>
      <SectionTitle title="Profile" />

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {profile === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading profile…</Text>
        </Card>
      )}

      {profile && (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {profile.photoUrl ? (
              <Image
                testID="profile-photo"
                source={{ uri: profile.photoUrl }}
                style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: tokens.color.surfaceMuted }}
              />
            ) : (
              <View
                testID="profile-initials"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: tokens.color.indigo50,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 20, fontWeight: '800', color: tokens.color.indigo }}>
                  {initials(profile.firstName, profile.lastName)}
                </Text>
              </View>
            )}
            <Text style={{ fontSize: 17, fontWeight: '800', color: tokens.color.ink }}>
              {profile.firstName} {profile.lastName}
            </Text>
          </Card>

          <Card style={{ paddingVertical: 2 }}>
            <InfoRow label="Admission no." value={profile.admissionNo} />
            <InfoRow label="Roll no." value={profile.rollNo} />
            <InfoRow label="Class" value={profile.className} />
          </Card>
        </>
      )}
    </Screen>
  );
}
