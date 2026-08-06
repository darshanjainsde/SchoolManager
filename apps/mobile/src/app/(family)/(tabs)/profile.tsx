import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentProfile } from '@/lib/portal';
import { signOut } from '@/lib/sign-out';
import { AppearanceSetting } from '@/components/AppearanceSetting';
import { EditableAvatar } from '@/components/EditableAvatar';
import { Card, Page, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** "AS" for Aarav Sharma — mirrors the web's `initials` (apps/web/app/portal/profile/page.tsx). */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** A `.pfrow` value line: quiet label, the figure itself in mono so a column of them lines up. */
function InfoRow({ label, value, first }: { label: string; value: string | null; first?: boolean }) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
      }}
    >
      <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{label}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: 12.5, fontWeight: '700', color: tokens.color.ink }}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

/** A `.pfrow` action line: a tinted icon tile, a label, and a chevron. */
function SettingRow({
  icon,
  label,
  onPress,
  testID,
  first,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
  first?: boolean;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: tokens.color.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 14 }}>{icon}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: tokens.color.ink }}>{label}</Text>
      <Text style={{ color: tokens.color.sub }}>›</Text>
    </Pressable>
  );
}

/**
 * Standalone, read-only mirror of the web's `/portal/profile`
 * (apps/web/app/portal/profile/page.tsx): photo (or an initials fallback),
 * name, admission no., roll no. and class.
 *
 * Repainted to the pitch's `.pfhead`: everything centred under an 82px
 * `.bigav` ringed twice (a paper gap, then indigo) so the disc reads as
 * mounted on the page rather than floating on it, with the admission number
 * set as the `.pfcode` chip — mono, wide-tracked, on an indigo tint. That code
 * is the one string on this screen a person reads out loud to the school
 * office, which is exactly why the pitch gives it a chip of its own instead of
 * burying it in a list of fields.
 *
 * Role-neutral — this is the STUDENT's own record, shown identically whether a
 * parent or the student is holding the phone (see role-neutral-copy.test.ts).
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
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {profile === null && !error && (
        <LoadingRows label="Loading profile…" rows={4} />
      )}

      {profile && (
        <>
          <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 2 }}>
            {/* `.bigav`'s double ring: a 3px paper gap, then the indigo
                keyline. Two rings, not one, because a single border reads as
                a frame while a gap + keyline reads as a photo mounted on a
                page — the whole conceit of this app. */}
            <View
              style={{
                padding: 3,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: tokens.color.indigo,
                backgroundColor: tokens.color.appBg,
              }}
            >
              <EditableAvatar
                size={82}
                photoUrl={profile.photoUrl}
                initials={initials(profile.firstName, profile.lastName)}
                onUploaded={(url) => setProfile((p) => (p ? { ...p, photoUrl: url } : p))}
              />
            </View>

            <Text style={{ fontFamily: font.serif, fontSize: 19, color: tokens.color.ink, marginTop: 10 }}>
              {profile.firstName} {profile.lastName}
            </Text>
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
              {profile.className ?? 'Class not set'} · roll {profile.rollNo ?? '—'}
            </Text>

            {/* `.pfcode` — the admission number as a chip. */}
            {profile.admissionNo && (
              <View
                style={{
                  marginTop: 8,
                  backgroundColor: tokens.color.indigo50,
                  borderRadius: 8,
                  paddingHorizontal: 11,
                  paddingVertical: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: font.mono,
                    fontSize: 12,
                    fontWeight: '700',
                    letterSpacing: 1.4,
                    color: tokens.color.indigoDeep,
                  }}
                >
                  {profile.admissionNo}
                </Text>
              </View>
            )}
          </View>

          <Page>
            <InfoRow first label="Roll no." value={profile.rollNo} />
            <InfoRow label="Class" value={profile.className} />
          </Page>
        </>
      )}

      {/* The family shelf (Phase 5·2): switch children or add another. */}
      <Page>
        <SettingRow
          testID="switch-diary"
          first
          icon="📚"
          label="Switch diary / add a child"
          onPress={() => router.push('/(family)/shelf')}
        />
      </Page>

      {/* Appearance lives here since the drawer replaced the More screen. */}
      <Card style={{ paddingVertical: 2 }}>
        <AppearanceSetting />
      </Card>

      {/* SIGN OUT LIVES HERE.
          It was reachable only from the tools drawer, behind a chevron FAB —
          the one screen on the phone where nobody looks for it. Every other app
          has taught people that signing out is at the bottom of Profile, so it
          is here as well as there. Styled as a quiet destructive action, not a
          primary button: it is the last thing on the screen, not the point of
          it. */}
      <Pressable
        testID="profile-signout"
        accessibilityRole="button"
        onPress={() => void signOut()}
        style={{
          marginTop: 4,
          borderWidth: 1,
          borderColor: tokens.color.red,
          borderRadius: 12,
          paddingVertical: 13,
        }}
      >
        <Text style={{ color: tokens.color.red, fontWeight: '700', textAlign: 'center', fontSize: 14 }}>
          Sign out
        </Text>
      </Pressable>
    </Screen>
  );
}
