import { useMemo } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@/lib/query';
import { type TournamentRow } from '@/lib/sports-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';

const TONE: Record<string, 'green' | 'amber' | 'neutral'> = { LIVE: 'green', DRAFT: 'amber', DONE: 'neutral' };
const WORD: Record<string, string> = { LIVE: 'Live', DRAFT: 'Draft', DONE: 'Done' };

/**
 * MEETS — live first, then drafts, then the finished ones. Building a meet
 * (days, venues, entrants for 1,800 children) stays on the web desk where
 * there is room for it; the phone is for running the day and entering what
 * happened.
 */
export default function Meets() {
  const q = useQuery<TournamentRow[]>('/sports/tournaments');
  const groups = useMemo(() => {
    const rows = q.data ?? [];
    return (['LIVE', 'DRAFT', 'DONE'] as const).map((s) => ({ status: s, rows: rows.filter((t) => t.status === s) })).filter((g) => g.rows.length);
  }, [q.data]);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Meets" />
      {q.loading && <LoadingRows label="Fetching the meets…" rows={3} />}
      {q.error && !q.data && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.data && groups.length === 0 && <Page><Empty icon="sports">No meets yet. Plan one on the web desk — the phone runs it on the day.</Empty></Page>}
      {groups.map((g) => (
        <Page key={g.status} testID={`meets-${g.status.toLowerCase()}`}>
          <PageHeader title={g.status === 'LIVE' ? 'Running now' : g.status === 'DRAFT' ? 'Being planned' : 'Finished'} icon="sports" />
          {g.rows.map((t, i) => (
            <Row key={t.id} first={i === 0} testID={`meet-${t.id}`} title={t.name} sub={`${formatDate(t.startsOn)} – ${formatDate(t.endsOn)} · ${t.events} event${t.events === 1 ? '' : 's'}`} right={<Pill tone={TONE[t.status] ?? 'neutral'}>{WORD[t.status] ?? t.status}</Pill>} onPress={() => router.push(`/(worker)/(tabs)/meets/${t.id}`)} />
          ))}
        </Page>
      ))}
    </Screen>
  );
}
