import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useSession } from '@/lib/use-session';
import { borrowerLine, dueWord, rupees, type Dashboard, type IssueCard, type MemberHit } from '@/lib/library-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Row, SearchBox } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { useTokens } from '@/theme/theme-context';

/**
 * THE COUNTER — the librarian's Today. One search line at the top, because
 * every visit to the counter starts with a child standing in front of it:
 * type a name or a code, open the reader, hand over or take back. Under
 * it, the three figures of the day and the loans due soonest. A scan-the-
 * barcode door is planned; it needs the camera permission the app does not
 * declare yet, so the accession number is typed for now.
 */
export default function Counter() {
  const tokens = useTokens();
  const session = useSession();
  const dash = useQuery<Dashboard>('/library/dashboard');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); setSearchErr(null); return; }
    let cancelled = false;
    const h = setTimeout(() => {
      api.request<MemberHit[]>(`/library/members?q=${encodeURIComponent(term)}`)
        .then((r) => { if (!cancelled) { setHits(r); setSearchErr(null); } })
        .catch((e: unknown) => { if (!cancelled) setSearchErr(e instanceof ApiError ? e.message : 'Search failed.'); });
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q]);

  const soon = useMemo(() => (dash.data?.outNow ?? []).slice(0, 8), [dash.data]);
  const today = dash.data?.today ?? new Date().toISOString().slice(0, 10);

  return (
    <Screen onRefresh={dash.refresh} refreshing={dash.refreshing}>
      <SectionTitle title={session?.displayName ? `Hi, ${session.displayName.split(' ')[0]}` : 'Counter'} right={<NotificationBell group="(worker)" />} />
      <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 11.5, color: tokens.color.sub }}>Library counter</Text>

      <SearchBox testID="counter-search" value={q} onChangeText={setQ} placeholder="Child's name or code, or a teacher" />
      {searchErr && <ErrorState error={searchErr} onRetry={() => setQ(`${q} `.trimEnd())} />}
      {hits && (
        <Page testID="counter-hits">
          {hits.length === 0 ? <Empty>No reader matches that. Try the first name only.</Empty> : hits.map((m, i) => (
            <Row key={`${m.kind}-${m.id}`} first={i === 0} testID={`hit-${m.id}`} title={m.name} sub={borrowerLine(m)} right={m.holding ? <Pill tone="indigo">{`${m.holding} out`}</Pill> : undefined} onPress={() => router.push(`/(worker)/(tabs)/counter/member/${m.kind.toLowerCase()}/${m.id}`)} />
          ))}
        </Page>
      )}

      {!hits && (
        <>
          {dash.loading && <LoadingRows label="Opening the counter…" rows={3} />}
          {dash.error && !dash.data && <ErrorState error={dash.error} onRetry={dash.reload} />}
          {dash.data && (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Figure testID="counter-out" label="Out now" value={String(dash.data.counts.outNow)} hint="books with readers" />
                <Figure testID="counter-due" label="Due this week" value={String(dash.data.counts.dueSoon)} hint="back by next week" tone={dash.data.counts.dueSoon ? 'warn' : undefined} />
                <Figure testID="counter-fines" label="Fines due" value={rupees(dash.data.counts.finesDueRupees)} hint="to collect" tone={dash.data.counts.finesDueRupees ? 'bad' : undefined} onPress={() => router.push('/(worker)/(tabs)/fines')} />
              </View>
              <Page testID="counter-soon">
                <PageHeader title="Due soonest" icon="library" />
                {soon.length === 0 ? <Empty icon="library">Nothing is out. The shelves are full.</Empty> : soon.map((c: IssueCard, i) => {
                  const w = dueWord(c.dueOn, today);
                  return <Row key={c.id} first={i === 0} testID={`soon-${c.id}`} title={c.title} sub={`${c.borrower.name} · ${borrowerLine(c.borrower)} · due ${formatDate(c.dueOn)}`} right={<Pill tone={w.tone}>{w.text}</Pill>} onPress={() => router.push(`/(worker)/(tabs)/counter/member/${c.borrower.kind.toLowerCase()}/${c.borrower.id}`)} />;
                })}
              </Page>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
