import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TeacherProfile } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/**
 * Minimal read-only mirror of the web's `/teacher/profile`
 * (apps/web/app/teacher/profile/page.tsx): name, email, phone, subjects
 * taught, class-teacher-of. Password change is deliberately NOT built here —
 * mobile v1 sends the teacher to the web portal for that instead of
 * half-building a security-sensitive form.
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
        <Card style={{ gap: 12 }}>
          <View>
            <Text style={labelStyle}>Name</Text>
            <Text style={valueStyle}>
              {profile.firstName} {profile.lastName}
            </Text>
          </View>
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
      )}

      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4 }}>
        Change your password on the web portal.
      </Text>
    </Screen>
  );
}
