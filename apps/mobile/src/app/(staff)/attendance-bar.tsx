import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  AttendanceRateRow,
  AttendanceRatesResult,
  MyClassSection,
  NotifyLowAttendanceResult,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** The benchmarks a school actually uses — a stepper, not a free slider, so
 *  the number a family is told is always a round one. */
const STEPS = [50, 60, 65, 70, 75, 80, 85, 90] as const;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * The attendance bar (Phase 5·3) — who is falling behind, and one tap to tell
 * their families.
 *
 * The benchmark control is a stepper over round numbers rather than a
 * continuous slider: a teacher choosing "72%" would be choosing a number they
 * cannot defend to a parent, and every school talks in fives. Moving it
 * re-filters the list instantly (the percentages are already loaded), so the
 * teacher sees exactly who a tap would reach BEFORE tapping.
 *
 * Everyone below the line is pre-selected but individually removable — the
 * teacher's judgement is the last word, ahead of the arithmetic. Families
 * inside the cooldown window are shown greyed with "told N days ago" rather
 * than hidden, so the absence of an action has a visible reason.
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

  // Below the line AND actually marked — a child with no register taken reads
  // as 0%, which is a gap in the record, not a fact about them.
  const below = useMemo(
    () => (data?.students ?? []).filter((s) => s.percent < threshold && s.total > 0),
    [data, threshold],
  );
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

  const row = (s: AttendanceRateRow) => {
    const inCooldown = s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < 7;
    const off = excluded.has(s.studentId) || inCooldown;
    return (
      <Pressable
        key={s.studentId}
        testID={`bar-row-${s.studentId}`}
        onPress={() => !inCooldown && toggle(s.studentId)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 10,
          opacity: off ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 42,
            alignItems: 'center',
            paddingVertical: 3,
            borderRadius: 8,
            backgroundColor: s.percent < threshold ? tokens.color.red50 : tokens.color.green50,
          }}
        >
          <Text
            style={{
              fontSize: 12.5,
              fontWeight: '800',
              color: s.percent < threshold ? tokens.color.red : tokens.color.green,
            }}
          >
            {s.percent}%
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '600' }}>{s.name}</Text>
          <Text style={{ color: tokens.color.sub, fontSize: 11 }}>
            {s.present} of {s.total} days
            {inCooldown ? ` · told ${daysSince(s.lastNoticeAt as string)}d ago` : ''}
          </Text>
        </View>
        {!inCooldown && (
          <Text style={{ color: off ? tokens.color.sub : tokens.color.indigo, fontSize: 12, fontWeight: '700' }}>
            {off ? 'Skipped' : '✓'}
          </Text>
        )}
      </Pressable>
    );
  };

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

      <Card testID="bar-benchmark">
        <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '700' }}>
          Below {threshold}%
        </Text>
        <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 3, marginBottom: 11 }}>
          {data
            ? `${below.length} of ${data.students.length} in ${data.className}, over ${data.daysMarked} marked days.`
            : 'Reading the register…'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {STEPS.map((step) => {
            const on = step === threshold;
            return (
              <Pressable
                key={step}
                testID={`bar-step-${step}`}
                onPress={() => setThreshold(step)}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: tokens.radius.chip,
                  backgroundColor: on ? tokens.color.indigo : tokens.color.surfaceMuted,
                }}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: '700',
                    color: on ? tokens.color.onBrand : tokens.color.sub,
                  }}
                >
                  {step}%
                </Text>
              </Pressable>
            );
          })}
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
