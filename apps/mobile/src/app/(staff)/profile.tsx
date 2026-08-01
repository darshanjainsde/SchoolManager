import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TeacherProfile } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { AppearanceSetting } from '@/components/AppearanceSetting';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
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
export default function Profile() {
  const tokens = useTokens();
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
    }, []),
  );

  const labelStyle = { fontSize: 11.5, fontWeight: '700' as const, color: tokens.color.sub };
  const valueStyle = { fontSize: 14, fontWeight: '600' as const, color: tokens.color.ink, marginTop: 2 };
  const mutedStyle = { fontSize: 13, color: tokens.color.sub, marginTop: 2 };

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
          {/* Photo-or-initials header — mirrors the family profile screen. */}
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

          <Card style={{ gap: 12 }}>
            <View>
              <Text style={labelStyle}>Email</Text>
              {profile.email ? (
                <Text style={valueStyle}>{profile.email}</Text>
              ) : (
                <Text style={mutedStyle}>Not on file</Text>
              )}
            </View>
            <View>
              <Text style={labelStyle}>Phone</Text>
              {profile.phone ? (
                <Text style={valueStyle}>{profile.phone}</Text>
              ) : (
                <Text style={mutedStyle}>Not on file</Text>
              )}
            </View>
            <View>
              <Text style={labelStyle}>Subjects taught</Text>
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
            </View>
            <View>
              <Text style={labelStyle}>Class teacher of</Text>
              {profile.classTeacherOf.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {profile.classTeacherOf.map((c) => (
                    <Pill key={c} tone="green">
                      {c}
                    </Pill>
                  ))}
                </View>
              ) : (
                <Text style={mutedStyle}>Not a class teacher</Text>
              )}
            </View>
          </Card>
        </>
      )}

      {/* Appearance lives here since the drawer replaced the More screen. */}
      <Card style={{ paddingVertical: 2 }}>
        <AppearanceSetting />
      </Card>

      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4 }}>
        Change your password on the web portal.
      </Text>
    </Screen>
  );
}
