import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  AttendanceRateRow,
  AttendanceRatesResult,
  MyClassSection,
  NotifyLowAttendanceResult,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { ThresholdSlider } from '@/components/ThresholdSlider';
import { DUR, EASE, useReduceMotion } from '@/theme/motion';
import { font } from '@/theme/tokens';
import { useTokens } from '@/theme/theme-context';

/**
 * The track runs the FULL 0-100.
 *
 * It used to start at 50, on the reasoning that a benchmark below half is a
 * different conversation. True, but it made the control contradict itself: 75%
 * landed at the exact midpoint of the track, so a bar labelled "75%" looked
 * half full. A slider's whole job is to show a value at a glance, and one that
 * has to be read off the number beside it is not doing that job.
 */
const MIN = 0;
const MAX = 100;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * A dashed horizontal rule, drawn as alternating segments rather than with
 * `borderStyle: 'dashed'`.
 *
 * WHY: RN's dashed border is honoured inconsistently (Android in particular
 * renders a hairline solid rule when only one edge has a width), and this
 * particular line is the entire point of the screen — if it ever draws solid
 * it stops reading as "a benchmark you chose" and starts reading as "a fact
 * about the class". Segments are dumb, but they are the same on both
 * platforms.
 */
function DashedRule({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 2 }}>
      {Array.from({ length: 32 }, (_, i) => (
        <View
          key={i}
          style={{ flex: 1, height: 2, backgroundColor: i % 2 === 0 ? color : undefined }}
        />
      ))}
    </View>
  );
}

/**
 * The attendance bar (Phase 5·3) — who is falling behind, and one tap to tell
 * their families.
 *
 * The benchmark is a LINE THE TEACHER SLIDES across the class's own
 * distribution. Moving it re-filters the list instantly (every percentage is
 * already loaded), so the teacher sees exactly who a tap would reach BEFORE
 * tapping — the slider is a question, the send button is the answer, and
 * nothing leaves the phone in between.
 *
 * Everyone below the line is pre-selected but individually removable — the
 * teacher's judgement is the last word, ahead of the arithmetic. Families
 * inside the cooldown window keep their row but wear a "told N days ago"
 * pill rather than disappearing, so the absence of an action has a visible
 * reason.
 */
export default function AttendanceBar() {
  const tokens = useTokens();
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [data, setData] = useState<AttendanceRatesResult | null>(null);
  const [threshold, setThreshold] = useState(75);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<NotifyLowAttendanceResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((d) => {
          if (cancelled) return;
          setClasses(d);
          setClassId((prev) => prev ?? d[0]?.classSectionId ?? null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load your classes.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (!classId) return;
      let cancelled = false;
      setError(null);
      setData(null);
      setResult(null);
      setExcluded(new Set());
      api
        .request<AttendanceRatesResult>(`/manage/attendance/rates?classSectionId=${classId}`)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not read attendance.');
        });
      return () => {
        cancelled = true;
      };
    }, [classId]),
  );

  // Only children with a register behind them get a bar or a row: a child with
  // no marks reads as 0%, which is a gap in the record, not a fact about them —
  // and a phantom 0% bar would make the class look worse than it is.
  const marked = useMemo(
    () =>
      (data?.students ?? [])
        .filter((s) => s.total > 0)
        .slice()
        .sort((a, b) => a.percent - b.percent),
    [data],
  );
  const below = useMemo(() => marked.filter((s) => s.percent < threshold), [marked, threshold]);
  const cooldown = useMemo(
    () => below.filter((s) => s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < 7),
    [below],
  );
  const willNotify = below.filter(
    (s) => !excluded.has(s.studentId) && !cooldown.some((c) => c.studentId === s.studentId),
  );

  const notify = async () => {
    if (!classId || willNotify.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.request<NotifyLowAttendanceResult>('/manage/attendance/notify-low', {
        method: 'POST',
        body: {
          classSectionId: classId,
          threshold,
          from: data?.from,
          to: data?.to,
          studentIds: willNotify.map((s) => s.studentId),
        },
      });
      setResult(res);
      // Reload so the "told N days ago" state is the server's, not a guess.
      const fresh = await api.request<AttendanceRatesResult>(
        `/manage/attendance/rates?classSectionId=${classId}`,
      );
      setData(fresh);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send those notices.');
    } finally {
      setSending(false);
    }
  };

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The pitch's `.lorow`: a name, a mono percentage, a quiet meta line, and a
   *  green pill when this family has already heard from you. The percentage is
   *  mono because these are figures a teacher scans down a column, not prose. */
  const row = (s: AttendanceRateRow, index: number) => {
    const inCooldown = s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < 7;
    const off = excluded.has(s.studentId) || inCooldown;
    const lo = s.percent < threshold;
    return (
      <Pressable
        key={s.studentId}
        testID={`bar-row-${s.studentId}`}
        onPress={() => !inCooldown && toggle(s.studentId)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          paddingVertical: 9,
          borderTopWidth: index === 0 ? 0 : 1,
          borderTopColor: tokens.color.line,
          opacity: off ? 0.5 : 1,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: tokens.color.ink, fontSize: 12, fontWeight: '700' }}>
            {s.name}
            {s.rollNo ? (
              <Text style={{ color: tokens.color.sub, fontWeight: '400' }}> · roll {s.rollNo}</Text>
            ) : null}
          </Text>
          <Text style={{ color: tokens.color.sub, fontSize: 9.5, marginTop: 2 }}>
            {s.present} of {s.total} days
          </Text>
        </View>
        {inCooldown && (
          <View
            style={{
              backgroundColor: tokens.color.green50,
              borderRadius: tokens.radius.chip,
              paddingHorizontal: 7,
              paddingVertical: 2,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '800', color: tokens.color.green }}>
              ✓ told {daysSince(s.lastNoticeAt as string)}d ago
            </Text>
          </View>
        )}
        <Text
          style={{
            fontFamily: font.mono,
            fontSize: 12,
            fontWeight: '700',
            color: lo ? tokens.color.red : tokens.color.green,
          }}
        >
          {s.percent}%
        </Text>
        {!inCooldown && (
          <Text style={{ color: off ? tokens.color.sub : tokens.color.indigo, fontSize: 12, fontWeight: '700' }}>
            {off ? 'Skipped' : '✓'}
          </Text>
        )}
      </Pressable>
    );
  };

  const chip = (label: string, bg: string, fg: string) => (
    <View style={{ backgroundColor: bg, borderRadius: tokens.radius.chip, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: fg }}>{label}</Text>
    </View>
  );

  return (
    <Screen>
      <SectionTitle title="Attendance · who needs a word" />

      {classes && classes.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {classes.map((c) => {
            const on = c.classSectionId === classId;
            return (
              <Pressable
                key={c.classSectionId}
                testID={`bar-class-${c.classSectionId}`}
                onPress={() => setClassId(c.classSectionId)}
                style={{
                  borderWidth: 1.5,
                  borderColor: on ? tokens.color.indigo : tokens.color.line,
                  backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
                  borderRadius: 11,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {error && <Toast kind="error" message={error} />}
      {result && (
        <Toast
          kind="success"
          testID="bar-result"
          message={
            result.notified === 0
              ? 'Nobody new to tell right now.'
              : `${result.notified} ${result.notified === 1 ? 'family' : 'families'} told privately.` +
                (result.skippedInCooldown
                  ? ` ${result.skippedInCooldown} skipped — already told this week.`
                  : '')
          }
        />
      )}

      <Card testID="bar-benchmark" style={{ overflow: 'hidden' }}>
        <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '700' }}>
          Below {threshold}%
        </Text>
        <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 3 }}>
          {data
            ? `${below.length} of ${data.students.length} in ${data.className}, over ${data.daysMarked} marked days.`
            : 'Reading the register…'}
        </Text>


        <ThresholdSlider
          testID="bar-threshold"
          accessibilityLabel="Attendance benchmark"
          value={threshold}
          min={MIN}
          max={MAX}
          onChange={setThreshold}
        />

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {chip(`${marked.length - below.length} above`, tokens.color.green50, tokens.color.green)}
          {chip(`${below.length} below`, tokens.color.red50, tokens.color.red)}
        </View>
      </Card>

      {data && below.length > 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginBottom: 3 }}>
            Tap a name to leave them out. Each family gets their own child’s number, privately —
            never a list.
          </Text>
          {below.map(row)}
          <Pressable
            testID="bar-notify"
            onPress={notify}
            disabled={sending || willNotify.length === 0}
            style={({ pressed }) => ({
              marginTop: 10,
              backgroundColor: tokens.color.indigo,
              opacity: sending || willNotify.length === 0 ? 0.45 : pressed ? 0.85 : 1,
              borderRadius: 13,
              paddingVertical: 13,
            })}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 14 }}>
              {sending
                ? 'Sending…'
                : willNotify.length === 0
                  ? 'Nobody to tell'
                  : `Tell ${willNotify.length} ${willNotify.length === 1 ? 'family' : 'families'}`}
            </Text>
          </Pressable>
          {cooldown.length > 0 && (
            <Text style={{ color: tokens.color.sub, fontSize: 11, marginTop: 8, textAlign: 'center' }}>
              {cooldown.length} already heard from you this week.
            </Text>
          )}
        </Card>
      )}

      {data && below.length === 0 && (
        <Card testID="bar-clear">
          <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '700' }}>
            Everyone is above {threshold}%.
          </Text>
          <Text style={{ color: tokens.color.sub, fontSize: 12, marginTop: 4 }}>
            Nothing to do here today.
          </Text>
        </Card>
      )}

      {data && data.students.length > below.length && (
        <>
          <SectionTitle title="Everyone else" />
          <Card>{data.students.filter((s) => !below.includes(s)).map(row)}</Card>
        </>
      )}
    </Screen>
  );
}
