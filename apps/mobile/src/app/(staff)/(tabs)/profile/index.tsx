import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { TeacherProfile } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { signOut } from '@/lib/sign-out';
import { ProfileMenu } from '@/components/ProfileMenu';
import { EditableAvatar } from '@/components/EditableAvatar';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** "AR" for Asha Rao — same rule as the family profile / web pages. */
function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * `.pfrow` — one ruled row: a tinted icon tile, the field's label, and its
 * value. Shared here rather than repeated four times so the rule, the tile
 * size and the gap can only ever be set in one place.
 */
function ProfileRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 11,
        paddingVertical: 11,
        borderTopWidth: 1,
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
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.7, color: tokens.color.sub }}>
          {label}
        </Text>
        {children}
      </View>
    </View>
  );
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
        <LoadingRows label="Loading profile…" rows={4} />
      )}

      {profile && (
        <>
          {/* `.pfhead` — the photo centred over a serif name, the way a staff
              record is laid out on a card rather than in a table row. The
              avatar keeps its own component (it is shared with the family
              profile and owns the upload flow); only its setting changed. */}
          <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 2 }}>
            <EditableAvatar
              photoUrl={profile.photoUrl}
              initials={initials(profile.firstName, profile.lastName)}
              onUploaded={(url) => setProfile((p) => (p ? { ...p, photoUrl: url } : p))}
            />
            <Text
              style={{
                fontFamily: font.serif,
                fontSize: 20,
                fontWeight: '700',
                color: tokens.color.ink,
                marginTop: 10,
              }}
            >
              {profile.firstName} {profile.lastName}
            </Text>
            {/* No subject/class summary line here on purpose: the card below
                already states both, and a profile that says the same fact
                twice makes the reader wonder which one is authoritative. */}
          </View>

          {/* `.pfrow` — each fact on its own ruled row behind a small tile,
              which is what turns a form-shaped stack of labels into a record
              card. */}
          <Card style={{ paddingVertical: 4 }}>
            <ProfileRow icon="✉️" label="Email">
              {profile.email ? (
                <Text style={valueStyle}>{profile.email}</Text>
              ) : (
                <Text style={mutedStyle}>Not on file</Text>
              )}
            </ProfileRow>
            <ProfileRow icon="📞" label="Phone">
              {profile.phone ? (
                <Text style={valueStyle}>{profile.phone}</Text>
              ) : (
                <Text style={mutedStyle}>Not on file</Text>
              )}
            </ProfileRow>
            <ProfileRow icon="📚" label="Subjects taught">
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
            </ProfileRow>
            <ProfileRow icon="🏫" label="Class teacher of">
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
            </ProfileRow>
          </Card>
        </>
      )}

      {/* THE DOORS (pitch №7): Appearance and Change password each open
          their own pushed screen instead of sitting fully unfolded here —
          which is what finally fits Sign out above the fold. */}
      <ProfileMenu
        rows={[
          { icon: '🎨', label: 'Appearance', route: '/(staff)/(tabs)/profile/appearance', testID: 'profile-menu-appearance' },
          { icon: '🔑', label: 'Change password', route: '/(staff)/(tabs)/profile/password', testID: 'profile-menu-password' },
        ]}
      />

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
