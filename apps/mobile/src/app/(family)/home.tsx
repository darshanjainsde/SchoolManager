import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { relativeTime, type Announcement, type AttendanceSummary, type StudentProfile } from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 14,
        paddingVertical: 13,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 10.5, fontWeight: '600', color: tokens.color.ink, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function todayStatusLabel(status: 'PRESENT' | 'ABSENT' | 'LATE' | null) {
  if (status === 'PRESENT') return '✓ Present today';
  if (status === 'LATE') return '⏱ Late today';
  if (status === 'ABSENT') return '✕ Absent today';
  return 'Attendance not yet marked today';
}

export default function Home() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus: a new notice or a fresh attendance mark should show
  // up the moment the family tab regains focus, not just on cold start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([
        api.request<StudentProfile>('/me/profile'),
        api.request<Announcement[]>('/me/announcements'),
        api.request<AttendanceSummary>('/me/attendance'),
      ])
        .then(([p, a, att]) => {
          if (cancelled) return;
          setProfile(p);
          setAnnouncements(a);
          setAttendance(att);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const today = todayISO();
  const todayStatus = attendance?.days.find((d) => d.date === today)?.status ?? null;
  const latestNotice = announcements?.[0] ?? null;
  const comingSoon = () => Alert.alert('Coming soon', 'This is on the way in a future update.');

  return (
    <Screen>
      <SectionTitle title="Home" />
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {profile === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading…</Text>
        </Card>
      )}
      {profile && (
        <View style={{ backgroundColor: tokens.color.indigo, borderRadius: 20, padding: 16 }}>
          <Text
            style={{
              color: '#fff',
              opacity: 0.85,
              fontSize: 11,
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Your child
          </Text>
          <Text style={{ color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 3 }}>
            {profile.firstName} {profile.lastName}
          </Text>
          <Text style={{ color: '#fff', opacity: 0.9, fontSize: 12.5, marginTop: 2 }}>
            {profile.className ?? 'No class assigned'}
            {profile.rollNo ? ` · Roll ${profile.rollNo}` : ''}
          </Text>
          <View
            style={{
              marginTop: 13,
              alignSelf: 'flex-start',
              backgroundColor: '#ffffff26',
              borderRadius: 11,
              paddingVertical: 7,
              paddingHorizontal: 11,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>
              {todayStatusLabel(todayStatus)}
            </Text>
          </View>
        </View>
      )}

      {profile && (
        <>
          <SectionTitle title="Needs your attention" />
          {!latestNotice && todayStatus !== 'ABSENT' && (
            <Card>
              <Text style={{ color: tokens.color.sub }}>You're all caught up.</Text>
            </Card>
          )}
          {todayStatus === 'ABSENT' && (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: tokens.color.red50,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 16 }}>⚠️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>
                  Marked absent today
                </Text>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                  Tap Attendance for details
                </Text>
              </View>
            </Card>
          )}
          {latestNotice && (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
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
                <Text style={{ fontSize: 16 }}>📣</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>
                  {latestNotice.title}
                </Text>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                  {latestNotice.classSectionId ? 'Your class' : 'Whole school'} ·{' '}
                  {relativeTime(latestNotice.createdAt)}
                </Text>
              </View>
            </Card>
          )}

          <SectionTitle title="Quick actions" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <QuickAction label="Attendance" onPress={() => router.push('/(family)/attendance')} />
            <QuickAction label="Notices" onPress={() => router.push('/(family)/notices')} />
            <QuickAction label="Holidays" onPress={() => router.push('/(family)/holidays')} />
            <QuickAction label="Timetable" onPress={comingSoon} />
          </View>
        </>
      )}
    </Screen>
  );
}
