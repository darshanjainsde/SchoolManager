import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { type AttendanceStatusValue, type SaveAttendanceResponse } from '@skoolos/types';
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

// REGISTER BY EXCEPTION. One tap cycles the cell; the teacher never selects a
// state directly, they walk the class marking only the students who aren't
// simply there. Same order as the web (apps/web/app/teacher/attendance/page.tsx)
// so a teacher who learns the cycle on one client already knows it on the
// other. Record-typed for the same reason as STATUS_LABEL: a fourth server
// state fails the build rather than dead-ending the cycle.
const CYCLE: Record<AttendanceStatusValue, AttendanceStatusValue> = {
  PRESENT: 'ABSENT',
  ABSENT: 'LATE',
  LATE: 'PRESENT',
};

// A marked cell drops its roll number for a glyph, so the exceptions are
// findable in a block of forty without reading a single figure.
const STATUS_GLYPH: Record<AttendanceStatusValue, string | null> = {
  PRESENT: null,
  ABSENT: '✕',
  LATE: '⏱',
};

// `.rcell` — tint behind, its own ink on top, one pair per state. `late` (not
// `amber`) is the ink on the amber tint for the same reason the web has a
// `--sk-late` at all: the brand accent shifts in dark mode and a status must
// not shift with it.
function cellTones(tokens: { color: ColorPalette }): Record<
  AttendanceStatusValue,
  { bg: string; ink: string }
> {
  return {
    PRESENT: { bg: tokens.color.green50, ink: tokens.color.green },
    ABSENT: { bg: tokens.color.red50, ink: tokens.color.red },
    LATE: { bg: tokens.color.amber50, ink: tokens.color.late },
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
  const CELL = cellTones(tokens);
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
  // The last cell the teacher tapped, kept so the caption under the grid can
  // NAME it and offer the way back. The grid is fast precisely because it
  // drops the names, so the one real risk it introduces is tapping the wrong
  // cell — this is the whole mitigation, and it holds `from` (not just `to`)
  // so Undo restores the exact prior state rather than assuming PRESENT.
  const [lastMark, setLastMark] = useState<{
    studentId: string;
    name: string;
    from: AttendanceStatusValue;
    to: AttendanceStatusValue;
  } | null>(null);

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
    // A wholesale reset makes the single-cell caption a lie (and its Undo
    // would restore one student into a roster that no longer matches), so
    // clear it rather than leave it describing a tap that's been overwritten.
    setLastMark(null);
    setRoster((rs) => (rs ?? []).map((x) => ({ ...x, status: 'PRESENT' })));
  };

  // ONE TAP PER EXCEPTION: present → absent → late → present. The only way
  // this screen sets a status now — there is no direct-select control, which
  // is what lets the roster be a block of roll numbers instead of a list of
  // rows carrying three buttons each.
  const cycle = (row: RosterRow) => {
    const to = CYCLE[row.status];
    setStatus(row.studentId, to);
    setLastMark({ studentId: row.studentId, name: row.name, from: row.status, to });
  };

  const undoLastMark = () => {
    if (!lastMark) return;
    setStatus(lastMark.studentId, lastMark.from);
    setLastMark(null);
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
      {/* THE REGISTER GRID (`.rgrid`/`.rcell`) — one square cell per student,
          not a row per student with three buttons on it. A class of forty is
          one block you take in at a glance instead of forty rows and a
          hundred and twenty controls to scan, and the only cells that stand
          out are the ones that needed action.

          A cell carries the ROLL NUMBER while present and swaps to a glyph
          once marked, so the exceptions are findable without reading any
          number. The name is deliberately NOT drawn on the cell — that is
          what makes the grid fast — but it IS the cell's accessible name, so
          a screen reader still announces "Asha Rao, roll 1, present". */}
      {rows.length > 0 && (
        <Card style={{ paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {rows.map((r) => {
              const tone = CELL[r.status];
              return (
                <Pressable
                  key={r.studentId}
                  testID={`cell-${r.studentId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}, roll ${r.rollNo ?? 'none'}, ${STATUS_LABEL[
                    r.status
                  ].toLowerCase()}`}
                  onPress={() => cycle(r)}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: tone.bg,
                    // `.rcell[data-status="ABSENT"]{transform:scale(1.06)}` — an
                    // absence is the mark that costs a deliberate tap, so it is
                    // the one that moves.
                    transform: r.status === 'ABSENT' ? [{ scale: 1.06 }] : [],
                  }}
                >
                  {/* Mono, like every figure in this product that has to line
                      up with its neighbours down a column. */}
                  <Text
                    style={{
                      fontFamily: font.mono,
                      fontSize: 12,
                      fontWeight: '700',
                      color: tone.ink,
                    }}
                  >
                    {STATUS_GLYPH[r.status] ?? r.rollNo ?? '·'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}
      {/* WHAT YOU JUST DID, IN WORDS. The grid's speed comes from dropping the
          names, so the one real risk is tapping the wrong cell — this line
          catches it, with the way back beside it. Before the first tap it
          carries the hint that answers the one question a green-looking
          register raises. */}
      {rows.length > 0 && (
        <View
          testID="register-said"
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            minHeight: 20,
            marginTop: -4,
          }}
        >
          {lastMark ? (
            <>
              <Text style={{ fontSize: 11.5, color: tokens.color.ink2 }}>
                {lastMark.name} · {STATUS_LABEL[lastMark.to].toLowerCase()}
              </Text>
              <Pressable testID="register-undo" accessibilityRole="button" onPress={undoLastMark}>
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: '700',
                    color: tokens.color.indigo,
                    textDecorationLine: 'underline',
                  }}
                >
                  Undo
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={{ fontSize: 10.5, color: tokens.color.sub, textAlign: 'center' }}>
              Everyone starts present — tap the absentees. Tap again for late.
            </Text>
          )}
        </View>
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
