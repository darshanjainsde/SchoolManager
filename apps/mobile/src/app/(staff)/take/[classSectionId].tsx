import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { buildMarksPayload, todayISO } from '@/lib/attendance';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

interface RosterRow {
  studentId: string;
  name: string;
  present: boolean;
}

// AttendanceService.list() returns only { studentId, status } — no names.
// Names come from the roster projection of GET /manage/students, which is
// keyed on the same `id`/`studentId` and ordered the same way (admissionNo
// asc); we join the two by id so a missing/late row on either side can't
// silently misalign names to the wrong student.
interface MarkRow {
  studentId: string;
  status: 'PRESENT' | 'ABSENT';
}
interface StudentRosterRow {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

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
              present: byId.get(s.id) !== 'ABSENT',
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
  const presentCount = rows.filter((r) => r.present).length;

  const toggle = (studentId: string, present: boolean) =>
    setRoster((rs) => (rs ?? []).map((x) => (x.studentId === studentId ? { ...x, present } : x)));

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
            {presentCount} present · {rows.length - presentCount} absent · {rows.length} total
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
                {(['Present', 'Absent'] as const).map((label) => {
                  const on = label === 'Present' ? r.present : !r.present;
                  const bg = on ? (label === 'Present' ? tokens.color.green : tokens.color.red) : 'transparent';
                  return (
                    <Pressable
                      key={label}
                      testID={`${label.toLowerCase()}-${r.studentId}`}
                      onPress={() => toggle(r.studentId, label === 'Present')}
                      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: bg }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? '#fff' : tokens.color.sub }}>
                        {label}
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
