import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

// ── Types ────────────────────────────────────────────────────────────────────
// Mirrors StaffAttendanceService.mine's MyStaffAttendanceResult
// (apps/api/src/modules/management/staff-attendance.service.ts) and the
// web's local copy (apps/web/app/staff/page.tsx) — kept local here too,
// same convention as this app's other screens (e.g. AttendanceSummary in
// lib/portal.ts is the one shared shape; most `/manage/*` response shapes
// are typed at the call site instead).

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';

interface PersonDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: Status;
}

interface PersonSummary {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  percent: number;
  days: PersonDay[];
}

interface MyStaffAttendance {
  person: { id: string; firstName: string; lastName: string; role: string };
  summary: PersonSummary;
}

const STATUS_LABEL: Record<Status, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  ON_LEAVE: 'On leave',
};

const STATUS_TONE: Record<Status, 'green' | 'red' | 'amber' | 'indigo'> = {
  PRESENT: 'green',
  ABSENT: 'red',
  LATE: 'amber',
  ON_LEAVE: 'indigo',
};

const STAFF_ROLE_LABEL: Record<string, string> = {
  OFFICE: 'Office staff',
  SUPPORT: 'Support staff',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  OTHER: 'Staff',
};

function StatBox({ testID, value, label, color }: { testID: string; value: string; label: string; color: string }) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        alignItems: 'center',
      }}
    >
      <Text testID={testID} style={{ fontSize: 20, fontWeight: '800', color }}>
        {value}
      </Text>
      <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export default function Today() {
  const tokens = useTokens();
  const [data, setData] = useState<MyStaffAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<MyStaffAttendance>('/manage/staff-attendance/mine')
        .then((res) => {
          if (!cancelled) setData(res);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const summary = data?.summary;
  const marked = summary ? summary.present + summary.absent + summary.late + summary.onLeave : 0;
  const recent = summary ? [...summary.days].reverse().slice(0, 10) : [];

  return (
    <Screen>
      <SectionTitle title={data ? `Hi, ${data.person.firstName}` : 'Today'} />
      {data && (
        <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 12, color: tokens.color.sub }}>
          {STAFF_ROLE_LABEL[data.person.role] ?? 'Staff'}
        </Text>
      )}

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {data === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your attendance…</Text>
        </Card>
      )}

      {summary && !error && marked === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No attendance has been recorded for you yet this month.</Text>
        </Card>
      )}

      {summary && !error && marked > 0 && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatBox testID="stat-percent" value={`${summary.percent}%`} label="This month" color={tokens.color.green} />
            <StatBox testID="stat-present" value={String(summary.present)} label="Present" color={tokens.color.ink} />
            <StatBox testID="stat-absent" value={String(summary.absent)} label="Absent" color={tokens.color.red} />
          </View>

          <SectionTitle title="Recent" />
          <Card style={{ paddingVertical: 2 }}>
            {recent.map((d) => (
              <View
                key={d.date}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 9,
                  borderBottomWidth: 1,
                  borderBottomColor: tokens.color.line,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{d.date}</Text>
                <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* Honest placeholder — see apps/web/app/staff/page.tsx's matching
          note for why: LeaveApplication is Teacher-row-scoped only today,
          and a Staff-row leave path is real schema work, not a focused diff
          to bolt on alongside an attendance view. */}
      <SectionTitle title="Leave" />
      <Card>
        <Text style={{ color: tokens.color.sub }}>
          Applying for leave isn&rsquo;t available here yet — ask your school admin in the meantime. It&rsquo;s
          planned for a future update.
        </Text>
      </Card>
    </Screen>
  );
}
