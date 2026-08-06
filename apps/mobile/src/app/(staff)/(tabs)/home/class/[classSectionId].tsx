import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { AttendanceStatusValue } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { Card, Page, PageHeader, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { Touchable } from '@/components/Touchable';
import { Icon } from '@/components/icons';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';

/**
 * THE CLASS IN FRONT OF YOU.
 *
 * Reached by tapping the "right now" hero on Home. It exists because the
 * register deliberately does not answer the question a teacher asks while
 * standing in the room: WHO is missing. The register is a block of forty
 * numbered squares precisely so it can be marked at walking pace — dropping the
 * names is what makes it fast — and the cost of that is that it cannot also be
 * the place you read names.
 *
 * So the two screens do one job each, the same split the rest of Home follows:
 *
 *   take/[classSectionId] — MARKING. A grid, no names, one tap per exception.
 *   class/[classSectionId] — LOOKING. Names, roll numbers, who is out today.
 *
 * Everything here is built from two endpoints that already exist and are
 * already used by the register (`/manage/students` and `/manage/attendance`),
 * so this screen adds a place to stand, not a new server contract.
 */

interface MarkRow {
  studentId: string;
  status: AttendanceStatusValue;
}

interface StudentRosterRow {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

interface RosterRow {
  studentId: string;
  name: string;
  rollNo: string | null;
  status: AttendanceStatusValue;
  /** False when the register has not been taken — see `marked` below. */
  known: boolean;
}

const STATUS_LABEL: Record<AttendanceStatusValue, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
};

/** Same tint/ink pairs as the register's cells, so a status means one thing app-wide. */
function statusTones(tokens: { color: ColorPalette }): Record<
  AttendanceStatusValue,
  { bg: string; ink: string }
> {
  return {
    PRESENT: { bg: tokens.color.green50, ink: tokens.color.green },
    ABSENT: { bg: tokens.color.red50, ink: tokens.color.red },
    LATE: { bg: tokens.color.amber50, ink: tokens.color.late },
  };
}

export default function ClassScreen() {
  const tokens = useTokens();
  const TONES = statusTones(tokens);
  const { classSectionId, name, subject, period, start, end, takenBy } = useLocalSearchParams<{
    classSectionId: string;
    name?: string;
    subject?: string;
    /** Period label ("P3"), for the line under the title. */
    period?: string;
    start?: string;
    end?: string;
    /** Who marked today's register, when someone has. Absent means not taken. */
    takenBy?: string;
  }>();
  const date = todayISO();

  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus, so coming back from the register shows the marks that
  // were just saved rather than the ones this screen loaded with.
  useFocusEffect(
    useCallback(() => {
      if (!classSectionId) return;
      let cancelled = false;
      setError(null);
      (async () => {
        try {
          const [marks, students] = await Promise.all([
            api.request<MarkRow[]>(
              `/manage/attendance?classSectionId=${classSectionId}&date=${date}`,
            ),
            api.request<StudentRosterRow[]>(`/manage/students?classSectionId=${classSectionId}`),
          ]);
          if (cancelled) return;
          const byId = new Map(marks.map((m) => [m.studentId, m.status]));
          setRoster(
            students.map((s) => ({
              studentId: s.id,
              name: `${s.firstName} ${s.lastName}`,
              rollNo: s.rollNo,
              status: byId.get(s.id) ?? 'PRESENT',
              known: byId.has(s.id),
            })),
          );
        } catch (e) {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [classSectionId, date]),
  );

  const rows = roster ?? [];
  // "Taken" is derived from the marks themselves, not from the `takenBy` param:
  // the param describes what Home knew when it linked here, and a colleague may
  // have marked the register in the seconds since. The rows are the truth.
  const marked = rows.some((r) => r.known);
  const absent = rows.filter((r) => r.known && r.status === 'ABSENT');
  const late = rows.filter((r) => r.known && r.status === 'LATE');
  const present = rows.filter((r) => r.known && r.status === 'PRESENT');

  const className = name ?? 'Class';

  function goTake() {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (takenBy) params.set('takenBy', takenBy);
    const qs = params.toString();
    router.push(`/(staff)/take/${classSectionId}${qs ? `?${qs}` : ''}`);
  }

  function goNotes() {
    const params = new URLSearchParams();
    if (className) params.set('className', className);
    if (subject) params.set('subjectName', subject);
    router.push(`/(staff)/(tabs)/home/notes/${classSectionId}?${params.toString()}`);
  }

  return (
    <Screen>
      <SectionTitle title={subject ? `${className} · ${subject}` : className} />
      {(period || start) && (
        <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 12, color: tokens.color.sub }}>
          {[period, start && end ? `${start}–${end}` : null].filter(Boolean).join(' · ')}
        </Text>
      )}

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}

      {roster === null && !error && <LoadingRows label="Loading the class…" rows={6} />}

      {roster !== null && !error && rows.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            No students in this class yet — your admin needs to enrol them.
          </Text>
        </Card>
      )}

      {roster !== null && !error && rows.length > 0 && (
        <>
          {/* THE REGISTER, IN ONE LINE AND ONE BUTTON. Whether it is done is the
              first thing a teacher wants from this screen, so it is the first
              thing on it — and the button changes verb rather than appearing
              and disappearing, so its position never moves. */}
          <Card style={{ gap: 11 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>
              {marked
                ? `${present.length} of ${rows.length} present`
                : `Register not taken · ${rows.length} students`}
            </Text>
            {marked ? (
              <Text testID="class-register-detail" style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: -6 }}>
                {[
                  absent.length > 0 ? `${absent.length} absent` : null,
                  late.length > 0 ? `${late.length} late` : null,
                  takenBy ? `marked by ${takenBy}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Nobody absent'}
              </Text>
            ) : (
              <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: -6 }}>
                Everyone shows as present below until it is taken.
              </Text>
            )}
            <Touchable
              testID="class-take"
              haptic="medium"
              onPress={goTake}
              accessibilityLabel={marked ? 'Edit the register' : 'Take the register'}
              style={{
                backgroundColor: tokens.color.indigo,
                borderRadius: 11,
                paddingVertical: 12,
              }}
            >
              <Text
                style={{
                  color: tokens.color.onBrand,
                  fontWeight: '700',
                  textAlign: 'center',
                  fontSize: 13,
                }}
              >
                {marked ? 'Edit register →' : 'Take register →'}
              </Text>
            </Touchable>
          </Card>

          {/* WHO IS OUT. Named first and on their own, because on a marked
              register this is the entire answer — scanning thirty green rows to
              find two red ones is work the screen should have already done. */}
          {marked && (absent.length > 0 || late.length > 0) && (
            <Page testID="class-exceptions">
              <PageHeader title="Not in the room" />
              {[...absent, ...late].map((r, i) => (
                <StudentRow key={r.studentId} row={r} tones={TONES} first={i === 0} />
              ))}
            </Page>
          )}

          <Page testID="class-roster">
            <PageHeader title={`Everyone · ${rows.length}`} />
            {rows.map((r, i) => (
              <StudentRow
                key={r.studentId}
                row={r}
                tones={TONES}
                first={i === 0}
                // Before the register is taken every row would wear an
                // identical green "Present" chip, which looks like a marked
                // class and is a lie. Unmarked rows show no status at all.
                mute={!r.known}
              />
            ))}
          </Page>

          <Touchable
            testID="class-notes"
            onPress={goNotes}
            style={{
              backgroundColor: tokens.color.indigo50,
              borderRadius: 11,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Icon name="notes" size={17} color={tokens.color.indigo} />
            <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>
              Class notes &amp; homework
            </Text>
          </Touchable>
        </>
      )}
    </Screen>
  );
}

/** One named pupil — roll number, name, and what today says about them. */
function StudentRow({
  row,
  tones,
  first,
  mute,
}: {
  row: RosterRow;
  tones: Record<AttendanceStatusValue, { bg: string; ink: string }>;
  first?: boolean;
  mute?: boolean;
}) {
  const tokens = useTokens();
  const tone = tones[row.status];
  return (
    <View
      testID={`class-row-${row.studentId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
      }}
    >
      {/* Mono, like every figure in this product that lines up down a column. */}
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 11.5,
          fontWeight: '700',
          color: tokens.color.sub,
          minWidth: 20,
        }}
      >
        {row.rollNo ?? '·'}
      </Text>
      <Text style={{ flex: 1, fontSize: 13, color: tokens.color.ink }} numberOfLines={1}>
        {row.name}
      </Text>
      {!mute && (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            fontSize: 10.5,
            fontWeight: '700',
            color: tone.ink,
            backgroundColor: tone.bg,
            borderRadius: 7,
            paddingHorizontal: 8,
            paddingVertical: 3,
            overflow: 'hidden',
          }}
        >
          {STATUS_LABEL[row.status]}
        </Text>
      )}
    </View>
  );
}
