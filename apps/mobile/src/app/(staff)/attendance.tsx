import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { RegisterChangeRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO, type ClassDayStatus } from '@/lib/attendance';
import { LockedDayCard } from '@/components/LockedDayCard';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { tokens } from '@/theme/tokens';

/** True once an APPROVED row's `expiresAt` is still in the future — absolute
 * epoch comparison, so it is correct regardless of the device's timezone.
 * `expiresAt` is only ever null for PENDING/REJECTED rows (see
 * RegisterChangeService.review); guard it anyway so a stray null can never
 * reach `new Date(null)` and misbehave. */
function isUnexpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() > Date.now();
}

export default function StaffAttendance() {
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState<ClassDayStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<RegisterChangeRow[] | null>(null);
  const [myRequestsError, setMyRequestsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});

  const today = todayISO();
  const isPast = date < today;
  const isFuture = date > today;

  // Refetch every time this tab regains focus (not just on mount) so a class
  // another teacher just marked shows as locked without a manual reload.
  // Also reruns whenever `date` changes (the arrows below produce a new
  // `date`, which gives this callback a new identity) — a future date is
  // never fetched at all, since there is nothing on the server to ask for
  // and no attendance can ever be taken there.
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
      api
        .request<ClassDayStatus[]>(`/manage/attendance/status?date=${date}`)
        .then((data) => {
          if (!cancelled) setRows(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [date]),
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
    router.push(`/(staff)/take/${c.classSectionId}?name=${encodeURIComponent(c.name)}${dateParam}`);
  };

  const confirmRetake = (c: ClassDayStatus) => {
    const when = date === today ? 'today' : `on ${date}`;
    Alert.alert(
      `Retake attendance for ${c.name}?`,
      `${c.name} was already marked by ${c.markedBy ?? 'a teacher'} ${when} — ` +
        `${c.present}/${c.total} present. Retaking overwrites the record for every ` +
        `teacher ${when}. The previous version stays in the audit log.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retake', style: 'destructive', onPress: () => goTake(c) },
      ],
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

  const renderClassCard = (c: ClassDayStatus) => (
    <Card key={c.classSectionId}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <View>
          <Text style={{ fontWeight: '700', fontSize: 14, color: tokens.color.ink }}>
            {c.name}
          </Text>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
            {c.taken ? `Taken by ${c.markedBy ?? '—'}` : `${c.total} students · not taken yet`}
          </Text>
        </View>
        {c.taken ? (
          <Pill tone="green">{`✓ ${c.present}/${c.total} present`}</Pill>
        ) : (
          <Pill tone="amber">Pending</Pill>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
        {c.taken ? (
          <Pressable
            onPress={() => confirmRetake(c)}
            testID={`retake-${c.classSectionId}`}
            style={{ flex: 1, backgroundColor: tokens.color.red50, borderRadius: 13, padding: 10 }}
          >
            <Text style={{ color: tokens.color.red, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
              Retake
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => goTake(c)}
            testID={`take-${c.classSectionId}`}
            style={{ flex: 1, backgroundColor: tokens.color.indigo, borderRadius: 13, padding: 11 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
              Take attendance now
            </Text>
          </Pressable>
        )}
      </View>
    </Card>
  );

  const renderRow = (c: ClassDayStatus) => {
    if (!isPast) return renderClassCard(c);

    const forThisDay = (r: RegisterChangeRow) => r.classSectionId === c.classSectionId && r.date === date;
    const pendingRow = myRequests?.find((r) => forThisDay(r) && r.status === 'PENDING') ?? null;
    const unlockRow =
      myRequests?.find((r) => forThisDay(r) && r.status === 'APPROVED' && isUnexpired(r.expiresAt)) ??
      null;

    if (unlockRow) return renderClassCard(c);

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
    <Screen>
      <SectionTitle title={`Attendance · ${date === today ? 'today' : date}`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 }}>
        <Pressable testID="date-prev" onPress={() => setDate((d) => shiftISO(d, -1))}>
          <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>‹ Prev day</Text>
        </Pressable>
        {date !== today && (
          <Pressable testID="date-today" onPress={() => setDate(today)}>
            <Text style={{ color: tokens.color.sub, fontWeight: '600', fontSize: 12 }}>Jump to today</Text>
          </Pressable>
        )}
        <Pressable testID="date-next" onPress={() => setDate((d) => shiftISO(d, 1))}>
          <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>Next day ›</Text>
        </Pressable>
      </View>
      <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginHorizontal: 4 }}>
        One record per class per day. Once any teacher takes it, it locks for everyone —
        retake needs confirmation.
      </Text>

      {isFuture ? (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You cannot take attendance for a future date.</Text>
        </Card>
      ) : (
        <>
          {error && (
            <Card>
              <Text style={{ color: tokens.color.red }}>{error}</Text>
            </Card>
          )}
          {isPast && myRequestsError && (
            <Card>
              <Text style={{ color: tokens.color.red }}>{myRequestsError}</Text>
            </Card>
          )}
          {rows === null && !error && (
            <Card>
              <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
            </Card>
          )}
          {rows?.length === 0 && (
            <Card>
              <Text style={{ color: tokens.color.sub }}>
                You have no classes assigned for attendance yet.
              </Text>
            </Card>
          )}
          {rows?.map((c) => renderRow(c))}
        </>
      )}
    </Screen>
  );
}
