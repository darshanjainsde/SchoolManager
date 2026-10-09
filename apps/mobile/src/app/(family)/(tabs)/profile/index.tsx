import { useReload } from '@/lib/query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentProfile } from '@/lib/portal';
import { signOut } from '@/lib/sign-out';
import { ProfileMenu } from '@/components/ProfileMenu';
import { InfoRow, ProfileGroup, ProfileHead, SignOutRow, useInfoValueStyle } from '@/components/ProfileKit';
import { Button } from '@/components/Button';
import { ErrorState, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { font } from '@/theme/tokens';
import { ask } from '@/components/ConfirmSheet';

/** "AS" for Aarav Sharma — mirrors the web's `initials` (apps/web/app/portal/profile/page.tsx). */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/** A `.pfrow` value line: quiet label, the value in tabular figures so a column of them lines up; `mono` for a code read character by character (the roll number). */
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
/**
 * One stray thumb used to clear the session AND every child on the shelf
 * (UI audit 2026-09-22, #13). Ask first, in the words that say what is lost.
 */
function confirmSignOut(who?: { initials: string; name: string; line?: string }): void {
  ask(
    'Sign out?',
    'This removes every profile on this phone. You can sign in again with your number.',
    [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ],
    { icon: 'signout', who, testID: 'confirm-signout' },
  );
}

export default function Profile() {
  const valueStyle = useInfoValueStyle();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
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
    }, [reloadKey]),
  );

  return (
    <Screen onRefresh={reload}>
      <SectionTitle title="Profile" />
      {error && <ErrorState error={error} onRetry={reload} />}
      {profile === null && !error && <LoadingRows label="Loading profile…" rows={4} />}

      {profile && (
        <>
          {/* sckools-ui-standards §6 — the profile recipe. "Switch child" is the
              head's one action: families with two children use it most. */}
          <ProfileHead
            photoUrl={profile.photoUrl}
            initials={initials(profile.firstName, profile.lastName)}
            name={`${profile.firstName} ${profile.lastName}`}
            line={`${profile.className ?? 'Class not set'} · Roll ${profile.rollNo ?? '—'}`}
            onUploaded={(url) => setProfile((p) => (p ? { ...p, photoUrl: url } : p))}
            action={
              <Button
                testID="switch-diary"
                variant="tonal"
                label="Switch child / add a child"
                onPress={() => router.push('/(family)/(tabs)/home/shelf')}
              />
            }
          />
          <View style={{ height: 16 }} />
          <ProfileGroup label="About">
            {/* The admission number is the one string read out to the office. */}
            {profile.admissionNo ? (
              <InfoRow first icon="person" label="Student code">
                <Text style={{ ...valueStyle, fontFamily: font.mono, letterSpacing: 1 }}>{profile.admissionNo}</Text>
              </InfoRow>
            ) : null}
            <InfoRow first={!profile.admissionNo} icon="home" label="Class">
              <Text style={valueStyle}>{profile.className ?? '—'}</Text>
            </InfoRow>
            <InfoRow icon="take" label="Roll no.">
              <Text style={{ ...valueStyle, fontVariant: ['tabular-nums'] }}>{profile.rollNo ?? '—'}</Text>
            </InfoRow>
          </ProfileGroup>
        </>
      )}

      <ProfileMenu
        rows={[
          { icon: 'palette', label: 'Appearance', route: '/(family)/(tabs)/profile/appearance', testID: 'profile-menu-appearance' },
          { icon: 'key', label: 'Change password', route: '/(family)/(tabs)/profile/password', testID: 'profile-menu-password' },
        ]}
      />

      {/* Sign out: last, red, alone — and it still asks first. */}
      <SignOutRow testID="profile-signout" onPress={() => confirmSignOut(profile ? { initials: initials(profile.firstName, profile.lastName), name: `${profile.firstName} ${profile.lastName}`, line: profile.className ?? undefined } : undefined)} />
    </Screen>
  );
}
