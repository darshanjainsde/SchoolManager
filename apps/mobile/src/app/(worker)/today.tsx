import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { Card, Empty, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

// ── The paper skin, for the staff who are not teachers ───────────────────────
// There is no pitch page for this role, so nothing here is invented: every
// piece is the same object a teacher already sees somewhere else — the pitch's
// `.regstat` figure boxes, a `.page` of ruled rows, a serif `.ph` heading, and
// the diary's own italic hand for a page with nothing written on it. Driver,
// office and security staff open the same app as the teachers; the one thing
// this screen must never look like is a different product.
//
// Deliberately no motion. The six gestures all mark a CHANGE to the page (a
// tick, a stamp, a pin…), and nothing on this screen changes: it is a record
// someone else wrote about you, read back. Animating it would be decoration
// pretending to be an event.

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

/**
 * The pitch's `.regstat` — a figure box off the register.
 *
 * The number is MONO because these three sit side by side and a percentage, a
 * count and another count only read as one row of figures when their digits are
 * the same width. The label under it is the pitch's small-caps meta: uppercase,
 * tracked, dim, in the UI sans — chrome a paper register would not contain, so
 * it stays out of the book face the headings use.
 */
function StatBox({ testID, value, label, color }: { testID: string; value: string; label: string; color: string }) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.surface,
        borderColor: tokens.color.line,
        borderWidth: 1,
        borderRadius: 11,
        paddingVertical: 9,
        paddingHorizontal: 10,
        alignItems: 'center',
      }}
    >
      <Text testID={testID} style={{ fontFamily: font.mono, fontSize: 19, fontWeight: '700', color }}>
        {value}
      </Text>
      <Text
        style={{
          fontSize: 8.5,
          fontWeight: '700',
          letterSpacing: 0.55,
          textTransform: 'uppercase',
          color: tokens.color.sub,
          marginTop: 3,
        }}
      >
        {label}
      </Text>
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
        // The pitch's `.gatesub` — the one line under a serif heading that says
        // whose page this is, in the UI sans so it never competes with it.
        <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 11.5, color: tokens.color.sub }}>
          {STAFF_ROLE_LABEL[data.person.role] ?? 'Staff'}
        </Text>
      )}

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {data === null && !error && (
        <LoadingRows label="Loading your attendance…" rows={3} />
      )}

      {summary && !error && marked === 0 && (
        // A month nobody has marked yet is a clean page, not a failure — so it
        // is said in the diary's own italic hand rather than in system grey.
        <Page>
          <PageHeader title="This month" icon="🗓" />
          <Empty>No attendance has been recorded for you yet this month.</Empty>
        </Page>
      )}

      {summary && !error && marked > 0 && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatBox testID="stat-percent" value={`${summary.percent}%`} label="This month" color={tokens.color.green} />
            <StatBox testID="stat-present" value={String(summary.present)} label="Present" color={tokens.color.ink} />
            <StatBox testID="stat-absent" value={String(summary.absent)} label="Absent" color={tokens.color.red} />
          </View>

          {/* A `.page` of ruled rows, not a stack of cards: these days are
              consecutive lines in one register, and a rule between them is what
              says so. The date is MONO so the column of dates lines up the way
              a register's does; the status keeps the same `Pill` tones the
              teacher's attendance screens use, so PRESENT is the same green
              everywhere in the app. */}
          <Page testID="recent-days">
            <PageHeader title="Recent" icon="📋" />
            {recent.map((d, i) => (
              <View
                key={d.date}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: tokens.color.line,
                }}
              >
                <Text style={{ fontFamily: font.mono, fontSize: 12, color: tokens.color.ink2 }}>{d.date}</Text>
                <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill>
              </View>
            ))}
          </Page>
        </>
      )}

      {/* Honest placeholder — see apps/web/app/staff/page.tsx's matching
          note for why: LeaveApplication is Teacher-row-scoped only today,
          and a Staff-row leave path is real schema work, not a focused diff
          to bolt on alongside an attendance view. Drawn as a page with nothing
          written on it, which is exactly what it is. */}
      <Page>
        <PageHeader title="Leave" icon="✉️" />
        <Empty>
          Applying for leave isn&rsquo;t available here yet — ask your school admin in the meantime. It&rsquo;s
          planned for a future update.
        </Empty>
      </Page>
    </Screen>
  );
}
