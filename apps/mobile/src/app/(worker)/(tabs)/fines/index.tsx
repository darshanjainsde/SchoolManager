import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { borrowerLine, rupees, type FineEntry, type FinesView } from '@/lib/library-desk';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * FINES — what is owed, by whom, and the two things a librarian does about
 * it: Collect (cash across the counter, marked paid) or Waive (the head
 * said so). A fine still growing on an open late loan is shown but cannot
 * be settled until the book is back — the row says so and opens the reader.
 * "Remind everyone" sends one notice per indebted reader through the
 * school's channels; it is a whole-list action and confirmed as one.
 */
export default function Fines() {
  const tokens = useTokens();
  const q = useQuery<FinesView>('/library/fines');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const groups = useMemo(() => {
    const fixed = (q.data?.entries ?? []).filter((e) => e.kind === 'FIXED');
    const growing = (q.data?.entries ?? []).filter((e) => e.kind === 'ACCRUING');
    return { fixed, growing };
  }, [q.data]);

  async function settle(e: FineEntry, how: 'collect' | 'waive') {
    setBusy(e.id);
    try {
      await api.request(`/library/fines/${e.id}/${how}`, { method: 'POST', body: {} });
      setToast({ kind: 'success', message: how === 'collect' ? `${rupees(e.amountRupees)} collected from ${e.borrower.name}.` : `Waived for ${e.borrower.name}.` });
      q.reload();
    } catch (err) {
      setToast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Could not settle that fine.' });
    } finally { setBusy(null); }
  }
  function ask(e: FineEntry, how: 'collect' | 'waive') {
    Alert.alert(how === 'collect' ? `Collect ${rupees(e.amountRupees)}?` : `Waive ${rupees(e.amountRupees)}?`, `${e.borrower.name} · ${e.title}`, [
      { text: 'No', style: 'cancel' },
      { text: how === 'collect' ? 'Collected' : 'Waive', style: how === 'waive' ? 'destructive' : 'default', onPress: () => void settle(e, how) },
    ]);
  }
  async function remind() {
    setBusy('remind');
    try {
      const r = await api.request<{ sent?: number; queued?: number }>('/library/fines/remind', { method: 'POST', body: {} });
      const n = r.sent ?? r.queued;
      setToast({ kind: 'success', message: n != null ? `Reminders sent to ${n} reader${n === 1 ? '' : 's'}.` : 'Reminders sent.' });
    } catch (err) {
      setToast({ kind: 'error', message: err instanceof ApiError ? err.message : 'Could not send reminders.' });
    } finally { setBusy(null); }
  }

  const total = q.data?.entries.length ?? 0;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Fines" actionLabel={total ? 'Remind all' : undefined} onAction={total ? () => Alert.alert('Remind every reader who owes?', `${total} notice${total === 1 ? '' : 's'} go out through the school's channels.`, [{ text: 'No', style: 'cancel' }, { text: 'Send', onPress: () => void remind() }]) : undefined} />
      {q.loading && <LoadingRows label="Adding up the fines…" rows={3} />}
      {q.error && !q.data && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.data && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure testID="fines-due" label="Owed" value={rupees(q.data.dueRupees)} hint={`${total} fine${total === 1 ? '' : 's'}`} tone={q.data.dueRupees ? 'bad' : undefined} />
            <Figure testID="fines-collected" label="Collected" value={rupees(q.data.collectedRupees)} hint="so far this year" tone="good" />
          </View>
          {total === 0 && <Page><Empty icon="fees">Nobody owes the library anything.</Empty></Page>}
          {groups.fixed.length > 0 && (
            <Page testID="fines-fixed">
              <PageHeader title="To settle" icon="fees" />
              {groups.fixed.map((e, i) => (
                <View key={e.id} testID={`fine-${e.id}`} style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontWeight: '700', color: tokens.color.ink, fontSize: 14 }}>{e.borrower.name}</Text>
                      <Text numberOfLines={1} style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 1 }}>{borrowerLine(e.borrower)} · {e.title} · {e.reason === 'LOST' ? 'lost' : e.detail}</Text>
                    </View>
                    <Text style={{ fontFamily: font.mono, fontWeight: '700', fontSize: 15, color: tokens.color.red }}>{rupees(e.amountRupees)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}><Button small variant="ghost" testID={`waive-${e.id}`} label="Waive" onPress={() => ask(e, 'waive')} busy={busy === e.id} /></View>
                    <View style={{ flex: 1 }}><Button small testID={`collect-${e.id}`} label="Collected" onPress={() => ask(e, 'collect')} busy={busy === e.id} /></View>
                  </View>
                </View>
              ))}
            </Page>
          )}
          {groups.growing.length > 0 && (
            <Page testID="fines-growing">
              <PageHeader title="Still growing" icon="library" />
              {groups.growing.map((e, i) => (
                <Row key={e.id} first={i === 0} testID={`growing-${e.id}`} title={e.borrower.name} sub={`${e.title} · ${e.detail} · settle when it is back`} right={<Pill tone="amber">{rupees(e.amountRupees)}</Pill>} onPress={() => router.push(`/(worker)/(tabs)/counter/member/${e.borrower.kind.toLowerCase()}/${e.borrower.id}`)} />
              ))}
            </Page>
          )}
        </>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} />}
    </Screen>
  );
}
