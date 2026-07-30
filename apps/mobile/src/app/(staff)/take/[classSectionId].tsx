import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatusValue,
  type SaveAttendanceResponse,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { buildMarksPayload, todayISO } from '@/lib/attendance';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import type { ColorPalette } from '@/theme/tokens';

interface RosterRow {
  studentId: string;
  name: string;
  rollNo: string | null;
  status: AttendanceStatusValue;
}

// Mirrors the web's exact wording (apps/web/app/teacher/attendance/page.tsx)
// so the two clients never promise different things for the same save. The
// server only emails guardians of students who became *newly* absent this
// save (de-duplicated server-side) — the zero-absentee branch exists so a
// full-attendance day never reads "0 absent … guardians are being notified",
// which would say guardians are being emailed when none are.
function saveConfirmationMessage(result: SaveAttendanceResponse): string {
  if (result.absentees === 0) {
    return `Attendance saved — ${result.saved} students, nobody absent.`;
  }
  return `Attendance saved — ${result.saved} students, ${result.absentees} absent. Guardians of absentees are being notified.`;
}

// AttendanceService.list() returns only { studentId, status } — no names.
// Names come from the roster projection of GET /manage/students, which is
// keyed on the same `id`/`studentId` and ordered the same way (admissionNo
// asc); we join the two by id so a missing/late row on either side can't
// silently misalign names to the wrong student.
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

// One entry per ATTENDANCE_STATUSES value, enforced by the Record type — if
// the server ever adds a fourth state, this fails to typecheck instead of
// silently rendering a button with no label or colour.
const STATUS_LABEL: Record<AttendanceStatusValue, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
};
function statusColor(tokens: { color: ColorPalette }): Record<AttendanceStatusValue, string> {
  return {
    PRESENT: tokens.color.green,
    ABSENT: tokens.color.red,
    LATE: tokens.color.amber,
  };
}

export default function TakeAttendance() {
  const tokens = useTokens();
  const STATUS_COLOR = statusColor(tokens);
  const { classSectionId, name, date: dateParam } = useLocalSearchParams<{
    classSectionId: string;
    name?: string;
    /** YYYY-MM-DD. Omitted by today's link (see attendance.tsx's `goTake`); a
     * past date only arrives here once the attendance list has already
     * established there's an unexpired APPROVED unlock for this class+date —
     * this screen just proxies whatever date it's given through to the GET
     * and PUT below. */
    date?: string;
  }>();
  const date = dateParam ?? todayISO();
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<SaveAttendanceResponse | null>(null);

  // Refetch on focus: if this is a retake, we want the freshest marks and
  // roster every time the screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      setRoster(null); // don't leak the previous class's rows while the new one loads
      Promise.all([
        api.request<MarkRow[]>(
          `/manage/attendance?classSectionId=${classSectionId}&date=${date}`,
        ),
        api.request<StudentRosterRow[]>(`/manage/students?classSectionId=${classSectionId}`),
      ])
        .then(([marks, students]) => {
          if (cancelled) return;
          const byId = new Map(marks.map((m) => [m.studentId, m.status]));
          setRoster(
            students.map((s) => ({
              studentId: s.id,
              name: `${s.firstName} ${s.lastName}`,
              rollNo: s.rollNo,
              // An unmarked student defaults to PRESENT — same default the
              // server applies in AttendanceService.list().
              status: byId.get(s.id) ?? 'PRESENT',
            })),
          );
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [classSectionId, date]),
  );

  const rows = roster ?? [];
  const presentCount = rows.filter((r) => r.status === 'PRESENT').length;
  const absentCount = rows.filter((r) => r.status === 'ABSENT').length;

  // Editing after a save invalidates the confirmation that's on screen — it
  // described a roster that no longer matches what's marked now, so it must
  // not linger next to the new edits.
  const setStatus = (studentId: string, status: AttendanceStatusValue) => {
    setConfirmation(null);
    setRoster((rs) => (rs ?? []).map((x) => (x.studentId === studentId ? { ...x, status } : x)));
  };

  // Local-only: sets every row to PRESENT so the teacher can review/adjust
  // before saving. Must never call the API itself — the Submit button is
  // still the only thing that writes.
  const markAllPresent = () => {
    setConfirmation(null);
    setRoster((rs) => (rs ?? []).map((x) => ({ ...x, status: 'PRESENT' })));
  };

  const submit = async () => {
    if (!classSectionId || rows.length === 0) return;
    setBusy(true);
    setError(null);
    setConfirmation(null);
    try {
      const result = await api.request<SaveAttendanceResponse>('/manage/attendance', {
        method: 'PUT',
        body: buildMarksPayload(classSectionId, date, rows),
      });
      // Show the confirmation here rather than navigating and hoping it
      // survives the transition — a message the teacher never sees is not a
      // confirmation. The roster stays on screen so they can keep marking
      // (e.g. a late arrival) before leaving via the Toast's own "Done".
      setConfirmation(result);
    } catch (e) {
      // Deliberately do NOT navigate on failure — the marked roster (still
      // held in `roster` state) must stay exactly as the teacher left it so
      // a network blip never costs them a re-mark.
      setError(e instanceof ApiError ? e.message : 'Could not save attendance.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle
        title={`${name ?? 'Class'} · Attendance${date === todayISO() ? '' : ` · ${date}`}`}
      />
      {confirmation && (
        <Toast
          kind="success"
          testID="save-confirmation"
          message={saveConfirmationMessage(confirmation)}
          actionLabel="Done"
          onAction={() => router.back()}
        />
      )}
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {roster === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading roster…</Text>
        </Card>
      )}
      {roster !== null && (
        <Card>
          <Text style={{ fontWeight: '700', color: tokens.color.ink }}>
            {presentCount} present · {absentCount} absent · {rows.length} total
          </Text>
        </Card>
      )}
      <Pressable
        onPress={markAllPresent}
        disabled={busy || rows.length === 0}
        testID="mark-all-present"
        style={{
          backgroundColor: tokens.color.indigo50,
          borderRadius: 13,
          padding: 11,
          opacity: busy || rows.length === 0 ? 0.6 : 1,
        }}
      >
        <Text style={{ color: tokens.color.indigo, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
          Mark all present
        </Text>
      </Pressable>
      {rows.length > 0 && (
        <Card style={{ paddingVertical: 2 }}>
          {rows.map((r) => (
            <View
              key={r.studentId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 9,
                borderBottomWidth: 1,
                borderBottomColor: tokens.color.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: tokens.color.ink }}>{r.name}</Text>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 1 }}>
                  Roll {r.rollNo ?? '—'}
                </Text>
              </View>
              <View
                style={{ flexDirection: 'row', backgroundColor: tokens.color.surfaceMuted, borderRadius: 10, padding: 3 }}
              >
                {ATTENDANCE_STATUSES.map((status) => {
                  const on = r.status === status;
                  const bg = on ? STATUS_COLOR[status] : 'transparent';
                  return (
                    <Pressable
                      key={status}
                      testID={`${status.toLowerCase()}-${r.studentId}`}
                      onPress={() => setStatus(r.studentId, status)}
                      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: bg }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? tokens.color.onBrand : tokens.color.sub }}>
                        {STATUS_LABEL[status]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </Card>
      )}
      <Pressable
        onPress={submit}
        disabled={busy || rows.length === 0}
        testID="submit-attendance"
        style={{ backgroundColor: tokens.color.indigo, borderRadius: 14, padding: 15, opacity: busy || rows.length === 0 ? 0.6 : 1 }}
      >
        <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
          {busy ? 'Submitting…' : 'Submit attendance'}
        </Text>
      </Pressable>
    </Screen>
  );
}
