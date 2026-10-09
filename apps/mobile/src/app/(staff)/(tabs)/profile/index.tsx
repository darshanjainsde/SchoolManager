import { useReload } from '@/lib/query';
import { useCallback, useState } from 'react';
import { Text, View, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TeacherProfile } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { signOut } from '@/lib/sign-out';
import { ProfileMenu } from '@/components/ProfileMenu';
import { InfoRow, ProfileGroup, ProfileHead, SignOutRow, useInfoValueStyle } from '@/components/ProfileKit';
import { ErrorState, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/** "AR" for Asha Rao — same rule as the family profile / web pages. */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * Minimal read-only mirror of the web's `/teacher/profile`
 * (apps/web/app/teacher/profile/page.tsx): photo (or an initials fallback),
 * name, email, phone, subjects taught, class-teacher-of. Password change is
 * deliberately NOT built here — mobile v1 sends the teacher to the web portal
 * for that instead of half-building a security-sensitive form.
 */
/**
 * One stray thumb used to clear the session AND every child on the shelf
 * (UI audit 2026-09-22, #13). Ask first, in the words that say what is lost.
 */
function confirmSignOut(): void {
  Alert.alert('Sign out?', 'This removes every profile on this phone. You can sign in again with your number.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
  ]);
}

export default function Profile() {
  const tokens = useTokens();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<TeacherProfile>('/manage/teachers/me')
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

  const valueStyle = useInfoValueStyle();
  const mutedStyle = { fontSize: 14, color: tokens.color.sub, marginTop: 2 };
  // The one line under the name: what they teach and which class is theirs,
  // built from the same fields as the rows below so the two cannot disagree.
  const line = profile
    ? [
        profile.subjects.length ? `${profile.subjects.join(', ')} teacher` : null,
        profile.classTeacherOf.length ? `Class teacher of ${profile.classTeacherOf.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Screen onRefresh={reload}>
      <SectionTitle title="Profile" />

      {error && <ErrorState error={error} onRetry={reload} />}
      {profile === null && !error && <LoadingRows label="Loading profile…" rows={4} />}

      {profile && (
        <>
          {/* sckools-ui-standards §6 — the profile recipe. */}
          <ProfileHead
            photoUrl={profile.photoUrl}
            initials={initials(profile.firstName, profile.lastName)}
            name={`${profile.firstName} ${profile.lastName}`}
            line={line}
            onUploaded={(url) => setProfile((p) => (p ? { ...p, photoUrl: url } : p))}
          />
          <View style={{ height: 16 }} />
          <ProfileGroup label="About">
            <InfoRow first icon="mail" label="Email">
              {profile.email ? <Text style={valueStyle}>{profile.email}</Text> : <Text style={mutedStyle}>Not on file</Text>}
            </InfoRow>
            {/* Shown only when there is one: the WhatsApp row below is where a number is added. */}
            {profile.phone ? (
              <InfoRow icon="phone" label="Phone">
                <Text style={valueStyle}>{profile.phone}</Text>
              </InfoRow>
            ) : null}
            <InfoRow icon="library" label="Subjects taught">
              {profile.subjects.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {profile.subjects.map((s) => (
                    <Pill key={s} tone="indigo">
                      {s}
                    </Pill>
                  ))}
                </View>
              ) : (
                <Text style={mutedStyle}>No subjects assigned</Text>
              )}
            </InfoRow>
            <InfoRow icon="home" label="Class teacher of">
              {profile.classTeacherOf.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {profile.classTeacherOf.map((c) => (
                    <Pill key={c} tone="indigo">
                      {c}
                    </Pill>
                  ))}
                </View>
              ) : (
                <Text style={mutedStyle}>Not a class teacher</Text>
              )}
            </InfoRow>
          </ProfileGroup>
        </>
      )}

      {/* THE DOORS (pitch №7): each opens its own pushed screen. */}
      <ProfileMenu
        rows={[
          { icon: 'palette', label: 'Appearance', route: '/(staff)/(tabs)/profile/appearance', testID: 'profile-menu-appearance' },
          { icon: 'key', label: 'Change password', route: '/(staff)/(tabs)/profile/password', testID: 'profile-menu-password' },
          { icon: 'phone', label: 'My WhatsApp number', route: '/(staff)/(tabs)/profile/phone', testID: 'profile-menu-phone' },
          { icon: 'person', label: 'Switch profile', route: '/(staff)/(tabs)/profile/switch', testID: 'profile-menu-switch' },
        ]}
      />

      {/* Sign out: last, red, alone — and it still asks first. */}
      <SignOutRow testID="profile-signout" onPress={confirmSignOut} />
    </Screen>
  );
}
