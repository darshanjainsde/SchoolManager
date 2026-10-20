import { fmtLongDay } from '@/lib/dates';
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useSession } from '@/lib/use-session';
import { borrowerLine, dueWord, rupees, type Dashboard, type IssueCard, type MemberHit } from '@/lib/library-desk';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen } from '@/components/ui';
import { Row, SearchBox } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { RoleHero } from '@/components/HeroDeck';
import { BandGreeting } from '@/components/BandHeader';
import { HomeMenu } from '@/components/HomeToolGrid';
import { NotificationBell } from '@/components/NotificationBell';
// The due date leads: it is the fact the row is sorted by, and the end of a
// long line is what a narrow phone cuts ("due Jul 21, 2…", re-audit 2026-10-08).
import { fmtDay } from '@/lib/dates';

/**
 * THE COUNTER — the librarian's Today. One search line at the top, because
 * every visit to the counter starts with a child standing in front of it:
 * type a name or a code, open the reader, hand over or take back. Under
 * it, the three figures of the day and the loans due soonest. A scan-the-
 * barcode door is planned; it needs the camera permission the app does not
 * declare yet, so the accession number is typed for now.
 */
export default function Counter() {
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
    <Screen band onRefresh={dash.refresh} refreshing={dash.refreshing}>
      <BandGreeting eyebrow={fmtLongDay(new Date())} line="Library counter" title={session?.displayName ?? 'Counter'} right={<NotificationBell group="(worker)" onBand />} />

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
              {/* THE HERO (9 Oct 2026): the counter's day + its quick actions. */}
              <RoleHero
                testID="counter-hero"
                quiet={dash.data.counts.dueSoon === 0}
                eyebrow="Library counter"
                title={`${dash.data.counts.outNow} ${dash.data.counts.outNow === 1 ? 'book' : 'books'} out`}
                line={dash.data.counts.dueSoon ? `${dash.data.counts.dueSoon} due back this week` : 'Nothing due back this week'}
                figures={[
                  { testID: 'counter-out', value: String(dash.data.counts.outNow), label: 'out now', family: 'learn' },
                  { testID: 'counter-due', value: String(dash.data.counts.dueSoon), label: 'due this week', tone: dash.data.counts.dueSoon ? 'warn' : 'good' },
                  { testID: 'counter-fines', value: rupees(dash.data.counts.finesDueRupees), label: 'fines due', family: 'money', onPress: () => router.push('/(worker)/(tabs)/fines') },
                ]}
              />

              {/* The counter's doors, once, on the grid (direction C). */}
              <HomeMenu
                tools={[
                  { label: 'Books', icon: 'library', testID: 'hero-act-books', route: '/(worker)/(tabs)/books' },
                  { label: 'Hall', icon: 'take', testID: 'hero-act-hall', route: '/(worker)/(tabs)/hall' },
                  { label: 'Fines', icon: 'fees', tone: 'amber' as const, testID: 'hero-act-fines', route: '/(worker)/(tabs)/fines' },
                  { label: 'My pay', icon: 'report', tone: 'green' as const, testID: 'hero-act-mypay', route: '/(worker)/(tabs)/profile/salary' },
                ]}
              />
              <Page testID="counter-soon">
                <PageHeader title="Due soonest" icon="library" />
                {soon.length === 0 ? <Empty icon="library">Nothing is out. The shelves are full.</Empty> : soon.map((c: IssueCard, i) => {
                  const w = dueWord(c.dueOn, today);
                  return <Row key={c.id} first={i === 0} testID={`soon-${c.id}`} title={c.title} sub={`due ${fmtDay(c.dueOn)} · ${c.borrower.name} · ${borrowerLine(c.borrower)}`} right={<Pill tone={w.tone}>{w.text}</Pill>} onPress={() => router.push(`/(worker)/(tabs)/counter/member/${c.borrower.kind.toLowerCase()}/${c.borrower.id}`)} />;
                })}
              </Page>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
