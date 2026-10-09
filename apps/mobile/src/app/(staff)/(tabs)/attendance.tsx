import { useReload } from '@/lib/query';
import { useCallback, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { RegisterChangeRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO, type ClassDayStatus } from '@/lib/attendance';
import { flush, pendingSaves, queueKey, type FlushResult } from '@/lib/offline-queue';
import { LockedDayCard } from '@/components/LockedDayCard';
import { Card, ErrorState, Pill, Screen, SectionTitle } from '@/components/ui';
import { DayControl } from '@/components/DayControl';
import { Icon } from '@/components/icons';
import { Touchable } from '@/components/Touchable';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/** True once an APPROVED row's `expiresAt` is still in the future — absolute
 * epoch comparison, so it is correct regardless of the device's timezone.
 * `expiresAt` is only ever null for PENDING/REJECTED rows (see
 * RegisterChangeService.review); guard it anyway so a stray null can never
 * reach `new Date(null)` and misbehave. */
function isUnexpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() > Date.now();
}

export default function StaffAttendance() {
  const tokens = useTokens();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<ClassDayStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<RegisterChangeRow[] | null>(null);
  const [myRequestsError, setMyRequestsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  // Classes with a save queued on the device (network failed when the
  // teacher submitted from the take screen) — keyed the same way the queue
  // itself is, `${classSectionId}:${date}`. Neither taken nor not-taken:
  // the device believes it's saved, the server doesn't know yet.
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  // Server `message`, verbatim, for a queued save the server has refused
  // (4xx) once flushed — surfaced on the class it belongs to.
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, string>>({});

  const today = todayISO();
  const isPast = date < today;
  const isFuture = date > today;

  // Away from today, Android's back returns to TODAY first (user, 9 Oct 2026:
  // "user lands on the previous day attendance when they want to go back").
  useFocusEffect(
    useCallback(() => {
      if (date === todayISO()) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setDate(todayISO());
        return true;
      });
      return () => sub.remove();
    }, [date]),
  );

  // Refetch every time this tab regains focus (not just on mount) so a class
  // another teacher just marked shows as locked without a manual reload.
  // Also reruns whenever `date` changes (the arrows below produce a new
  // `date`, which gives this callback a new identity) — a future date is
  // never fetched at all, since there is nothing on the server to ask for
  // and no attendance can ever be taken there.
  //
  // Also attempts to flush the offline attendance queue BEFORE fetching
  // status, so a save that can now reach the server (connectivity
  // returned) is reflected in this same fetch rather than showing stale
  // "not taken" for another screen's worth of latency. This is one of the
  // two flush triggers the queue relies on (see src/lib/offline-queue.ts);
  // the other is right before a fresh submit on the take screen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      if (date > todayISO()) {
        setRows(null);
        return () => {
          cancelled = true;
        };
      }
      (async () => {
        const result = await flush(api).catch(
          (): FlushResult => ({ synced: [], rejected: [], retained: [] }),
        );
        if (cancelled) return;
        if (result.rejected.length > 0) {
          setRejectedByKey((prev) => {
            const next = { ...prev };
            for (const r of result.rejected) next[r.entry.key] = r.message;
            return next;
          });
        }
        try {
          const data = await api.request<ClassDayStatus[]>(`/manage/attendance/status?date=${date}`);
          if (!cancelled) setRows(data);
        } catch (e) {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        }
        const pending = await pendingSaves().catch(() => []);
        if (!cancelled) setPendingKeys(new Set(pending.map((p) => p.key)));
      })();
      return () => {
        cancelled = true;
      };
    }, [date, reloadKey]),
  );

  // Only needed once a past date is on screen — no point asking every time,
  // and it drives whether a closed day's request form or its pending state
  // is shown (see the `requestsLoading` gate on LockedDayCard below).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setMyRequestsError(null);
      if (date >= todayISO()) {
        setMyRequests(null);
        return () => {
          cancelled = true;
        };
      }
      setMyRequests(null);
      api
        .request<RegisterChangeRow[]>('/manage/register-changes/mine')
        .then((data) => {
          if (!cancelled) setMyRequests(data);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // Fail open rather than trapping the teacher in "loading" forever —
          // the server still guards against a real duplicate with its own
          // 409 (REGISTER_CHANGE_OPEN) on submit.
          setMyRequests([]);
          setMyRequestsError(
            e instanceof ApiError ? e.message : 'Could not check for existing requests.',
          );
        });
      return () => {
        cancelled = true;
      };
    }, [date]),
  );

  const goTake = (c: ClassDayStatus) => {
    // Keep today's link exactly as it was before this date control existed —
    // only a non-today date adds the `date` param.
    const dateParam = date === todayISO() ? '' : `&date=${date}`;
    // A marked class carries who marked it, so the register screen can name
    // them and confirm before REPLACING their record. Opening is free; the
    // save is what needs the warning, and that is where it now lives.
    const takenParam = c.taken ? `&takenBy=${encodeURIComponent(c.markedBy ?? 'a teacher')}` : '';
    router.push(
      `/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}${dateParam}${takenParam}`,
    );
  };

  const submitRequest = async (c: ClassDayStatus, reason: string) => {
    setSubmitting((s) => ({ ...s, [c.classSectionId]: true }));
    setSubmitErrors((s) => {
      if (!(c.classSectionId in s)) return s;
      const next = { ...s };
      delete next[c.classSectionId];
      return next;
    });
    try {
      const created = await api.request<RegisterChangeRow>('/manage/register-changes', {
        method: 'POST',
        body: { classSectionId: c.classSectionId, date, reason },
      });
      setMyRequests((prev) => (prev ? [created, ...prev] : [created]));
    } catch (e) {
      setSubmitErrors((s) => ({
        ...s,
        [c.classSectionId]: e instanceof ApiError ? e.message : 'Could not send the request.',
      }));
    } finally {
      setSubmitting((s) => ({ ...s, [c.classSectionId]: false }));
    }
  };

  /**
   * One tile on the register wall (pitch №3): the whole tile is the tap —
   * "open this class's register" — instead of a full-width card carrying its
   * own button. A waiting tile is RAISED (shadow + elevation, pushed back
   * down by Touchable's press-in scale); a taken one lies flat and quiet.
   * `fullWidth` is for the past-day list, where locked and unlocked classes
   * interleave vertically and a half-width tile would break the column.
   *
   * Same testIDs as the old card (`take-` / `retake-` / `pending-sync-` /
   * `sync-rejected-`): the behaviour under test — what a tap opens, what a
   * queued save shows — is unchanged; only the shape is new.
   */
  // THE CLASS CARD (sckools-ui-standards, 9 Oct 2026): full width, so ten
  // classes are a list and not a wall of half-tiles; the class, its size and
  // ONE clear action. A taken register shows its count and who took it.
  const renderClassTile = (c: ClassDayStatus, _fullWidth = false) => {
    const key = queueKey(c.classSectionId, date);
    const isPendingSync = pendingKeys.has(key);
    const rejectedMessage = rejectedByKey[key] ?? null;
    const absent = Math.max(0, c.total - c.present);
    const pct = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0;
    return (
      <Touchable
        key={c.classSectionId}
        testID={c.taken ? `retake-${c.classSectionId}` : `take-${c.classSectionId}`}
        onPress={() => goTake(c)}
        haptic={c.taken ? 'light' : 'medium'}
        accessibilityLabel={
          c.taken
            ? `${c.name}, taken by ${c.markedBy ?? 'a teacher'}, ${c.present} of ${c.total} present. Open register`
            : `${c.name}, ${c.total} students, not taken yet. Take attendance`
        }
        style={{
          borderRadius: tokens.radius.card,
          padding: 16,
          gap: 14,
          backgroundColor: tokens.color.surface,
          borderWidth: 1,
          borderColor: tokens.color.line,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: c.taken ? tokens.color.indigo50 : tokens.color.indigo,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontWeight: '700', fontSize: 15, color: c.taken ? tokens.color.indigo : tokens.color.onBrand }} numberOfLines={1}>
              {c.name.trim().split(/[\s-]+/)[0].slice(0, 4)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontWeight: '600', fontSize: 17, lineHeight: 22, color: tokens.color.ink }}>
              {c.name}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, marginTop: 2 }}>
              {c.taken ? `Taken by ${c.markedBy ?? '—'}` : `${c.total} students · not taken yet`}
            </Text>
          </View>
          {c.taken && !isPendingSync ? (
            <Pill tone="green">{`✓ ${c.present}/${c.total} present`}</Pill>
          ) : null}
        </View>

        {c.taken ? (
          <View style={{ gap: 6 }}>
            <View style={{ height: 6, borderRadius: 99, backgroundColor: tokens.color.red50, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 99, backgroundColor: tokens.color.green }} />
            </View>
            <Text style={{ fontSize: 13, color: tokens.color.sub, fontVariant: ['tabular-nums'] }}>
              {`${c.present} present · ${absent} absent · tap to open`}
            </Text>
          </View>
        ) : isPendingSync ? null : (
          // The action, drawn as the card's button; the whole card is the target.
          <View
            style={{
              height: 48,
              borderRadius: 999,
              backgroundColor: tokens.color.indigo,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Icon name="take" size={20} color={tokens.color.onBrand} fillOpacity={0.3} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: tokens.color.onBrand }}>Take register</Text>
          </View>
        )}

        {isPendingSync ? (
          <View testID={`pending-sync-${c.classSectionId}`} style={{ flexDirection: 'row' }}>
            <Pill tone="indigo">Saved on device · syncing</Pill>
          </View>
        ) : null}
        {rejectedMessage && (
          <Text testID={`sync-rejected-${c.classSectionId}`} style={{ color: tokens.color.red, fontSize: 13 }}>
            {rejectedMessage}
          </Text>
        )}
      </Touchable>
    );
  };

  const renderRow = (c: ClassDayStatus) => {
    const forThisDay = (r: RegisterChangeRow) => r.classSectionId === c.classSectionId && r.date === date;
    const pendingRow = myRequests?.find((r) => forThisDay(r) && r.status === 'PENDING') ?? null;
    const unlockRow =
      myRequests?.find((r) => forThisDay(r) && r.status === 'APPROVED' && isUnexpired(r.expiresAt)) ??
      null;

    if (unlockRow) return renderClassTile(c, true);

    return (
      <LockedDayCard
        key={c.classSectionId}
        testID={`locked-day-${c.classSectionId}`}
        className={c.name}
        date={date}
        status={c}
        requestPending={!!pendingRow}
        requestsLoading={myRequests === null}
        isSubmitting={!!submitting[c.classSectionId]}
        error={submitErrors[c.classSectionId] ?? null}
        onRequestChange={(reason) => submitRequest(c, reason)}
      />
    );
  };

  return (
    <Screen onRefresh={reload}>
      {/* Title row: away from today it carries the same round back button
          every pushed screen has — back means "back to today" here. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
        {date !== today ? (
          <Pressable
            testID="date-back-today"
            accessibilityRole="button"
            accessibilityLabel="Back to today"
            onPress={() => setDate(today)}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: tokens.color.surface,
              borderWidth: 1,
              borderColor: tokens.color.line,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="chevron" size={20} color={tokens.color.ink} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <SectionTitle title="Attendance" />
        </View>
      </View>

      <DayControl date={date} today={today} onChange={setDate} />
      <Text style={{ color: tokens.color.sub, fontSize: 13, lineHeight: 18, marginHorizontal: 4 }}>
        One register per class per day. Once any teacher takes it, it locks for everyone.
      </Text>

      {isFuture ? (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You cannot take attendance for a future date.</Text>
        </Card>
      ) : (
        <>
          {error && <ErrorState error={error} onRetry={reload} />}
          {isPast && myRequestsError && (
            <Card>
              <Text style={{ color: tokens.color.red }}>{myRequestsError}</Text>
            </Card>
          )}
          {rows === null && !error && (
            <LoadingRows label="Loading your classes…" rows={5} />
          )}
          {rows?.length === 0 && (
            <Card>
              <Text style={{ color: tokens.color.sub }}>
                You have no classes assigned for attendance yet.
              </Text>
            </Card>
          )}

          {/* THE REGISTER WALL (pitch №3) — today (and any unlocked view of
              today): the day at a glance, then waiting classes as raised
              tiles, then the taken ones flat below a rule. Past days keep the
              vertical list: locked classes carry the request-unlock flow and
              interleave with any unlocked ones, which a grid would scramble. */}
          {rows && rows.length > 0 && !isPast && (
            <>
              <View style={{ marginHorizontal: 2, gap: 5 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                    <Text style={{ fontWeight: '800', color: tokens.color.ink }}>
                      {`${rows.filter((c) => c.taken).length} of ${rows.length}`}
                    </Text>
                    {' registers taken'}
                  </Text>
                  {rows.some((c) => !c.taken) && (
                    <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                      {`${rows.filter((c) => !c.taken).length} waiting`}
                    </Text>
                  )}
                </View>
                {/* The ink line: how far through the day's marking we are. */}
                <View
                  testID="register-progress"
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: rows.length,
                    now: rows.filter((c) => c.taken).length,
                  }}
                  style={{
                    height: 5,
                    borderRadius: 99,
                    backgroundColor: tokens.color.surfaceMuted,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round((rows.filter((c) => c.taken).length / rows.length) * 100)}%`,
                      height: '100%',
                      borderRadius: 99,
                      backgroundColor: tokens.color.indigo,
                    }}
                  />
                </View>
              </View>

              {rows.some((c) => !c.taken) && (
                <>
                  <Text style={wallEyebrow(tokens)}>Still to take</Text>
                  <View style={{ gap: 12 }}>
                    {rows.filter((c) => !c.taken).map((c) => renderClassTile(c))}
                  </View>
                </>
              )}
              {rows.some((c) => c.taken) && (
                <>
                  {rows.some((c) => !c.taken) && (
                    <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, marginHorizontal: 2, marginTop: 4 }} />
                  )}
                  <Text style={wallEyebrow(tokens)}>Taken</Text>
                  <View style={{ gap: 12 }}>
                    {rows.filter((c) => c.taken).map((c) => renderClassTile(c))}
                  </View>
                </>
              )}
            </>
          )}
          {rows && rows.length > 0 && isPast && rows.map((c) => renderRow(c))}
        </>
      )}
    </Screen>
  );
}

/** The small letter-spaced label that titles a wall section. */
function wallEyebrow(tokens: ReturnType<typeof useTokens>) {
  return {
    marginHorizontal: 4,
    marginBottom: -2,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: 'uppercase' as const,
    fontWeight: '700' as const,
    color: tokens.color.sub,
  };
}

