import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  AttendanceRateRow,
  AttendanceRatesResult,
  NotifyLowAttendanceResult,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Page, PageHeader, Toast } from '@/components/ui';
import { ThresholdSlider } from '@/components/ThresholdSlider';
import { font } from '@/theme/tokens';
import { useTokens } from '@/theme/theme-context';

/** Matches the server's `NOTICE_COOLDOWN_DAYS`. */
const COOLDOWN_DAYS = 7;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Who in THIS class is falling behind, and one tap to tell their families.
 *
 * Sits UNDER THE REGISTER, on the same screen, for the same class — the twin
 * of the web's `components/teacher/WhoNeedsAWord.tsx`. It was a separate tab
 * with its own class picker, which meant picking the class twice to answer a
 * question about the register you were already looking at.
 *
 * No chart. An earlier version drew a per-student histogram with the benchmark
 * ruled across it; on a real class it misled, because a healthy class bunches
 * into near-identical bars and the rule appears to cut through children who
 * are comfortably above it. The two counts say it unmissably.
 */
export function WhoNeedsAWord({
  classSectionId,
  className,
}: {
  classSectionId: string;
  className: string;
}) {
  const tokens = useTokens();
  const [data, setData] = useState<AttendanceRatesResult | null>(null);
  const [threshold, setThreshold] = useState(75);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<NotifyLowAttendanceResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!classSectionId) return;
      let cancelled = false;
      setError(null);
      api
        .request<AttendanceRatesResult>(`/manage/attendance/rates?classSectionId=${classSectionId}`)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not read attendance.');
        });
      return () => {
        cancelled = true;
      };
    }, [classSectionId]),
  );

  const students = data?.students ?? [];
  const marked = students.filter((s) => s.total > 0);
  const below = marked.filter((s) => s.percent < threshold);
  const inCooldown = (s: AttendanceRateRow) =>
    s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < COOLDOWN_DAYS;
  const willNotify = below.filter((s) => !excluded.has(s.studentId) && !inCooldown(s));
  const cooling = below.filter(inCooldown);

  const notify = async () => {
    if (willNotify.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.request<NotifyLowAttendanceResult>('/manage/attendance/notify-low', {
        method: 'POST',
        body: {
          classSectionId,
          threshold,
          from: data?.from,
          to: data?.to,
          studentIds: willNotify.map((s) => s.studentId),
        },
      });
      setResult(res);
      setExcluded(new Set());
      const fresh = await api.request<AttendanceRatesResult>(
        `/manage/attendance/rates?classSectionId=${classSectionId}`,
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

  if (!data && !error) return null;

  return (
    <Page testID="who-needs-a-word">
      <PageHeader title="Who needs a word" />
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>
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

        {data && (
          <>
            <ThresholdSlider
              testID="bar-threshold"
              value={threshold}
              onChange={setThreshold}
              accessibilityLabel="Attendance benchmark"
            />

            <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>
              {below.length === 0
                ? `Everyone in ${className} is above ${threshold}%, over ${data.daysMarked} marked days.`
                : `${below.length} of ${marked.length} in ${className} below ${threshold}%, over ${data.daysMarked} marked days. Each family hears only about their own child — never a list.`}
            </Text>

            {below.map((s, i) => {
              const cool = inCooldown(s);
              const off = excluded.has(s.studentId) || cool;
              return (
                <Pressable
                  key={s.studentId}
                  testID={`bar-row-${s.studentId}`}
                  onPress={() => !cool && toggle(s.studentId)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    paddingVertical: 9,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: tokens.color.line,
                    opacity: off ? 0.5 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: tokens.color.ink, fontSize: 13.5, fontWeight: '700' }}>
                      {s.name}
                    </Text>
                    <Text style={{ color: tokens.color.sub, fontSize: 11, marginTop: 2 }}>
                      {s.present} of {s.total} days
                      {cool ? ` · told ${daysSince(s.lastNoticeAt as string)}d ago` : ''}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: font.mono,
                      fontSize: 13,
                      fontWeight: '700',
                      color: tokens.color.red,
                    }}
                  >
                    {s.percent}%
                  </Text>
                  {!cool && (
                    <Text
                      style={{
                        color: off ? tokens.color.sub : tokens.color.indigo,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      {off ? 'Skipped' : '✓'}
                    </Text>
                  )}
                </Pressable>
              );
            })}

            <Pressable
              testID="bar-notify"
              onPress={notify}
              disabled={sending || willNotify.length === 0}
              style={{
                backgroundColor: tokens.color.indigo,
                borderRadius: 11,
                paddingVertical: 13,
                opacity: sending || willNotify.length === 0 ? 0.45 : 1,
              }}
            >
              <Text
                style={{
                  color: tokens.color.onBrand,
                  fontWeight: '700',
                  textAlign: 'center',
                  fontSize: 13.5,
                }}
              >
                {sending
                  ? 'Sending…'
                  : willNotify.length === 0
                    ? 'Nobody to tell'
                    : `Tell ${willNotify.length} ${willNotify.length === 1 ? 'family' : 'families'}`}
              </Text>
            </Pressable>

            {cooling.length > 0 && (
              <Text style={{ fontSize: 11, color: tokens.color.sub, textAlign: 'center' }}>
                {cooling.length} already heard from you this week.
              </Text>
            )}
          </>
        )}
      </View>
    </Page>
  );
}
