import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ATTENDANCE_STATUSES, type AttendanceStatusValue } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { buildMarksPayload, todayISO } from '@/lib/attendance';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

interface RosterRow {
  studentId: string;
  name: string;
  status: AttendanceStatusValue;
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
const STATUS_COLOR: Record<AttendanceStatusValue, string> = {
  PRESENT: tokens.color.green,
  ABSENT: tokens.color.red,
  LATE: tokens.color.amber,
};

export default function TakeAttendance() {
  const { classSectionId, name } = useLocalSearchParams<{
    classSectionId: string;
    name?: string;
  }>();
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Refetch on focus: if this is a retake, we want the freshest marks and
  // roster every time the screen comes back into view.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      setRoster(null); // don't leak the previous class's rows while the new one loads
      const date = todayISO();
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
    }, [classSectionId]),
  );

  const rows = roster ?? [];
  const presentCount = rows.filter((r) => r.status === 'PRESENT').length;
  const absentCount = rows.filter((r) => r.status === 'ABSENT').length;

  const setStatus = (studentId: string, status: AttendanceStatusValue) =>
    setRoster((rs) => (rs ?? []).map((x) => (x.studentId === studentId ? { ...x, status } : x)));

  const submit = async () => {
    if (!classSectionId || rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.request('/manage/attendance', {
        method: 'PUT',
        body: buildMarksPayload(classSectionId, todayISO(), rows),
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save attendance.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle title={`${name ?? 'Class'} · Attendance`} />
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
              <Text style={{ flex: 1, fontWeight: '600', color: tokens.color.ink }}>{r.name}</Text>
              <View
                style={{ flexDirection: 'row', backgroundColor: '#F1F3F7', borderRadius: 10, padding: 3 }}
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
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? '#fff' : tokens.color.sub }}>
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
        <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>
          {busy ? 'Submitting…' : 'Submit attendance'}
        </Text>
      </Pressable>
    </Screen>
  );
}
