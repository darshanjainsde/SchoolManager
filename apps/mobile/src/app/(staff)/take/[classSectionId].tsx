import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatusValue,
  type SaveAttendanceResponse,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { buildMarksPayload, todayISO } from '@/lib/attendance';
import { enqueueSave, flush } from '@/lib/offline-queue';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';
import { DUR, stampStyle, useGesture } from '@/theme/motion';

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

/**
 * THE STAMP (`.bigstamp`) — the register is the one page a teacher must
 * *close*, and a rubber stamp is what closing a page looks like on paper: it
 * arrives oversized and crooked, thumps past its resting size and settles a
 * few degrees off square. It exists so "saved" is felt, not merely read;
 * the Toast beside it carries the actual numbers. Mounted only once the
 * SERVER has confirmed, so the stamp can never claim a save that didn't
 * happen — a queued/offline save deliberately gets no stamp, only the
 * pending Toast.
 */
function SavedStamp() {
  const tokens = useTokens();
  const land = useGesture(true, DUR.stamp);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View
        style={[
          {
            borderWidth: 2.5,
            borderColor: tokens.color.green,
            borderRadius: 10,
            paddingVertical: 6,
            paddingHorizontal: 16,
          },
          stampStyle(land),
        ]}
      >
        <Text
          style={{
            fontFamily: font.serif,
            fontWeight: '700',
            fontSize: 15,
            color: tokens.color.green,
          }}
        >
          Register saved
        </Text>
      </Animated.View>
    </View>
  );
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
  // True once this exact save has been queued on the device because the PUT
  // couldn't reach the server (see `submit` below) — distinct from
  // `confirmation` (server confirmed) and `error` (server or client
  // rejected it outright).
  const [pendingOffline, setPendingOffline] = useState(false);

  // Refetch on focus: if this is a retake, we want the freshest marks and
  // roster every time the screen comes back into view. Also attempts to
  // flush any save queued earlier for ANY class+date (not just this one) —
  // one of the two flush triggers the offline queue relies on; the other is
  // right before a fresh submit, below.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      setRoster(null); // don't leak the previous class's rows while the new one loads
      (async () => {
        // Best-effort: a flush failure here (still offline) must not block
        // the roster fetch below — it just means whatever's queued stays
        // queued and this GET reads whatever the server currently has.
        await flush(api).catch(() => undefined);
        if (cancelled) return;
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
              // An unmarked student defaults to PRESENT — same default the
              // server applies in AttendanceService.list().
              status: byId.get(s.id) ?? 'PRESENT',
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
  const presentCount = rows.filter((r) => r.status === 'PRESENT').length;
  const absentCount = rows.filter((r) => r.status === 'ABSENT').length;

  // Editing after a save invalidates the confirmation (or pending-offline
  // notice) that's on screen — it described a roster that no longer
  // matches what's marked now, so it must not linger next to the new edits.
  const setStatus = (studentId: string, status: AttendanceStatusValue) => {
    setConfirmation(null);
    setPendingOffline(false);
    setRoster((rs) => (rs ?? []).map((x) => (x.studentId === studentId ? { ...x, status } : x)));
  };

  // Local-only: sets every row to PRESENT so the teacher can review/adjust
  // before saving. Must never call the API itself — the Submit button is
  // still the only thing that writes.
  const markAllPresent = () => {
    setConfirmation(null);
    setPendingOffline(false);
    setRoster((rs) => (rs ?? []).map((x) => ({ ...x, status: 'PRESENT' })));
  };

  const submit = async () => {
    if (!classSectionId || rows.length === 0) return;
    setBusy(true);
    setError(null);
    setConfirmation(null);
    setPendingOffline(false);
    const built = buildMarksPayload(classSectionId, date, rows);
    try {
      // A save queued earlier for this same class+date (or any other) may
      // now be able to reach the server — clear it first so it can't later
      // clobber whatever this fresh submit is about to write.
      await flush(api).catch(() => undefined);
      const result = await api.request<SaveAttendanceResponse>('/manage/attendance', {
        method: 'PUT',
        body: built,
      });
      // Show the confirmation here rather than navigating and hoping it
      // survives the transition — a message the teacher never sees is not a
      // confirmation. The roster stays on screen so they can keep marking
      // (e.g. a late arrival) before leaving via the Toast's own "Done".
      setConfirmation(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // No signal at all (safeFetch's status-0 ApiError) — not a
        // rejection, so don't show an error. Save it on the device instead;
        // it'll sync the next time this screen (or another attendance
        // screen) gets a chance to flush.
        await enqueueSave(built);
        setPendingOffline(true);
      } else {
        // Deliberately do NOT navigate on failure — the marked roster
        // (still held in `roster` state) must stay exactly as the teacher
        // left it so a network blip never costs them a re-mark.
        setError(e instanceof ApiError ? e.message : 'Could not save attendance.');
      }
    } finally {
      setBusy(false);
    }
  };

  // `.regstat .n` — the pitch sets every countable figure in the mono face so
  // the three numerals line up as a column of figures would in a paper
  // register. Only the NUMBERS are mono; the words stay in the UI sans, per
  // the type rule in theme/tokens.ts.
  const statNumber = (color: string) => ({
    fontFamily: font.mono,
    fontSize: 17,
    fontWeight: '700' as const,
    color,
  });

  return (
    <Screen>
      <SectionTitle
        title={`${name ?? 'Class'} · Attendance${date === todayISO() ? '' : ` · ${date}`}`}
      />
      {confirmation && <SavedStamp />}
      {confirmation && (
        <Toast
          kind="success"
          testID="save-confirmation"
          message={saveConfirmationMessage(confirmation)}
          actionLabel="Done"
          onAction={() => router.back()}
        />
      )}
      {pendingOffline && (
        <Toast
          kind="pending"
          testID="offline-pending-toast"
          message="No signal — attendance saved on this device. It will sync automatically once you're back online."
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
      {/* `.regstats` — the running count, mono numerals on paper. Kept as ONE
          text run (rather than the pitch's three separate tiles) because that
          exact sentence is this screen's published summary; the mono/colour
          treatment per figure is what carries the tile idea across. */}
      {roster !== null && (
        <Card style={{ paddingVertical: 9, alignItems: 'center' }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: tokens.color.sub,
              textAlign: 'center',
            }}
          >
            <Text style={statNumber(tokens.color.green)}>{presentCount}</Text> present ·{' '}
            <Text style={statNumber(tokens.color.red)}>{absentCount}</Text> absent ·{' '}
            <Text style={statNumber(tokens.color.ink)}>{rows.length}</Text> total
          </Text>
        </Card>
      )}
      <Pressable
        onPress={markAllPresent}
        disabled={busy || rows.length === 0}
        testID="mark-all-present"
        style={{
          backgroundColor: tokens.color.indigo50,
          borderRadius: 11,
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
                {/* The roll number is a figure that must line up down the
                    column — the pitch's `.mkrow .rl`/`.rcell` mono. */}
                <Text
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: tokens.color.sub,
                    marginTop: 2,
                  }}
                >
                  Roll {r.rollNo ?? '—'}
                </Text>
              </View>
              {/* `.rgrid`/`.rcell` — a recessed tray of equal, square-ish tap
                  targets. The pitch's register is a single cycling cell per
                  student; this screen keeps its three-way control (its testIDs
                  and direct-selection behaviour are a published contract), so
                  the cell vocabulary lands on the three targets instead: the
                  SELECTED one carries the state at full ink. */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 4,
                  backgroundColor: tokens.color.surfaceMuted,
                  borderRadius: 11,
                  padding: 3,
                }}
              >
                {ATTENDANCE_STATUSES.map((status) => {
                  const on = r.status === status;
                  const bg = on ? STATUS_COLOR[status] : 'transparent';
                  return (
                    <Pressable
                      key={status}
                      testID={`${status.toLowerCase()}-${r.studentId}`}
                      onPress={() => setStatus(r.studentId, status)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 11,
                        borderRadius: 9,
                        backgroundColor: bg,
                        // `.rcell.A{transform:scale(1.06)}` — an absence is the
                        // exception the whole page exists to record, so the cell
                        // that holds it sits a touch proud of its neighbours and
                        // can be found without reading a single word.
                        transform: on && status === 'ABSENT' ? [{ scale: 1.06 }] : [],
                      }}
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
      {/* `.reghint` — the quiet line under the grid that answers the one
          question a blank-looking register raises. */}
      {rows.length > 0 && (
        <Text
          style={{
            fontSize: 10.5,
            color: tokens.color.sub,
            textAlign: 'center',
            marginTop: -4,
          }}
        >
          Everyone starts present — only the exceptions cost a tap.
        </Text>
      )}
      <Pressable
        onPress={submit}
        disabled={busy || rows.length === 0}
        testID="submit-attendance"
        style={{ backgroundColor: tokens.color.indigo, borderRadius: 11, padding: 14, opacity: busy || rows.length === 0 ? 0.6 : 1 }}
      >
        <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
          {busy ? 'Submitting…' : 'Submit attendance'}
        </Text>
      </Pressable>
    </Screen>
  );
}
