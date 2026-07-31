import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import {
  daysUntilLabel,
  formatDate,
  relativeTime,
  type Announcement,
  type AttendanceSummary,
  type PublishedResult,
  type StudentProfile,
  type UpcomingExam,
} from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** How many of the most recent announcements the home screen surfaces (the full list lives on Notices). */
const LATEST_ANNOUNCEMENTS_COUNT = 3;

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useTokens();
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

/** A compact KPI tile — the mobile equivalent of the web portal's `sk-kpi` stat tiles. */
function KpiTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const tokens = useTokens();
  const toneColor: Record<'good' | 'warn' | 'bad', string> = {
    good: tokens.color.green,
    warn: tokens.color.late,
    bad: tokens.color.red,
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
      }}
    >
      <Text style={{ fontSize: 10.5, fontWeight: '600', color: tokens.color.sub }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '800', color: tone ? toneColor[tone] : tokens.color.ink, marginTop: 2 }}>
        {value}
      </Text>
      {hint && (
        <Text style={{ fontSize: 10, color: tokens.color.sub, marginTop: 1 }} numberOfLines={1}>
          {hint}
        </Text>
      )}
    </View>
  );
}

function AnnouncementRow({ a }: { a: Announcement }) {
  const tokens = useTokens();
  return (
    <Card key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
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
        <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{a.title}</Text>
        <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
          {a.classSectionId ? 'Your class' : 'Whole school'} · {relativeTime(a.createdAt)}
        </Text>
      </View>
    </Card>
  );
}

export default function Home() {
  const tokens = useTokens();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus: a new notice, a fresh attendance mark, a newly
  // scheduled test or a newly published result should all show up the
  // moment the family tab regains focus, not just on cold start.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([
        api.request<StudentProfile>('/me/profile'),
        api.request<Announcement[]>('/me/announcements'),
        api.request<AttendanceSummary>('/me/attendance'),
        api.request<UpcomingExam[]>('/me/exams'),
        api.request<PublishedResult[]>('/me/results'),
      ])
        .then(([p, a, att, ex, res]) => {
          if (cancelled) return;
          setProfile(p);
          setAnnouncements(a);
          setAttendance(att);
          setExams(ex);
          setResults(res);
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
  const attendanceMarked = attendance ? attendance.present + attendance.absent + attendance.late : 0;
  const nextExam = exams?.[0] ?? null;
  const latestResult = results?.[0] ?? null;
  const latestAnnouncements = (announcements ?? []).slice(0, LATEST_ANNOUNCEMENTS_COUNT);

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
        <>
          {/* Identity card — name, class and roll are the student's OWN, not
              a parent-facing "your child" label. With one shared STUDENT
              login the app cannot tell whether a parent or the student is
              holding the phone, so this must read correctly to either. */}
          <View style={{ backgroundColor: tokens.color.indigo, borderRadius: 20, padding: 16 }}>
            <Text style={{ color: tokens.color.onBrand, fontSize: 19, fontWeight: '800' }}>
              {profile.firstName} {profile.lastName}
            </Text>
            <Text style={{ color: tokens.color.onBrand, opacity: 0.9, fontSize: 12.5, marginTop: 3 }}>
              {profile.className ?? 'No class assigned'}
              {profile.rollNo ? ` · Roll ${profile.rollNo}` : ''}
            </Text>
            <View
              style={{
                marginTop: 13,
                alignSelf: 'flex-start',
                // 15% translucent `onBrand` — a subtle highlight over the
                // solid-indigo card in both schemes (white-on-indigo in light,
                // near-black-on-lavender in dark, matching the text above).
                backgroundColor: `${tokens.color.onBrand}26`,
                borderRadius: 11,
                paddingVertical: 7,
                paddingHorizontal: 11,
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontSize: 12.5, fontWeight: '600' }}>
                {todayStatusLabel(todayStatus)}
              </Text>
            </View>
          </View>

          {/* Next-test reminder — the thing a student should never miss, same
              framing as the web portal's `sk-remind` banner. Tapping it opens
              the full next-test detail (syllabus, max marks, date) on the
              Results screen, which also shows the student's published
              results underneath. */}
          {nextExam && (
            <Pressable testID="next-exam-banner" onPress={() => router.push('/(family)/results')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: tokens.color.amber50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 16 }}>🔔</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>
                    {nextExam.subjectName} · {nextExam.title} — {daysUntilLabel(nextExam.scheduledAt).toLowerCase()}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                    {formatDate(nextExam.scheduledAt)}
                    {nextExam.syllabus ? ` · ${nextExam.syllabus}` : ''} · out of {nextExam.maxMarks}
                  </Text>
                </View>
              </Card>
            </Pressable>
          )}

          {/* At-a-glance KPIs. Only two tiles, not the web's four — "today"
              is already the identity card's status chip above, and "next
              test" is already the banner above, so repeating them here would
              just be noise. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <KpiTile
              label="This month"
              value={attendanceMarked > 0 ? `${attendance?.percent}%` : 'No records'}
              hint={attendanceMarked > 0 ? `${attendance?.present} of ${attendanceMarked} days present` : undefined}
              tone={attendance && attendanceMarked > 0 && attendance.percent < 75 ? 'warn' : undefined}
            />
            <KpiTile
              label="Latest result"
              value={latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : 'None yet'}
              hint={latestResult ? `${latestResult.subjectName} · class avg ${latestResult.classAverage}` : undefined}
              tone={latestResult ? (latestResult.marks < latestResult.classAverage ? 'bad' : 'good') : undefined}
            />
          </View>

          <SectionTitle title="Latest announcements" />
          {latestAnnouncements.length === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No announcements yet.</Text>
            </Card>
          ) : (
            latestAnnouncements.map((a) => <AnnouncementRow key={a.id} a={a} />)
          )}

          <SectionTitle title="Quick actions" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <QuickAction label="Attendance" onPress={() => router.push('/(family)/attendance')} />
            <QuickAction label="Notices" onPress={() => router.push('/(family)/notices')} />
            <QuickAction label="Timetable" onPress={() => router.push('/(family)/timetable')} />
            <QuickAction label="Assignments" onPress={() => router.push('/(family)/assignments')} />
          </View>
        </>
      )}
    </Screen>
  );
}
