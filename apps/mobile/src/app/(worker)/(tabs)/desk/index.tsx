import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@/lib/query';
import { useSession } from '@/lib/use-session';
import { useDeskMe } from '@/lib/use-desk';
import { can, standings, type HouseRow, type RecordView, type TournamentRow } from '@/lib/sports-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Row, Swatch } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { RoleHero } from '@/components/HeroDeck';
import { NotificationBell } from '@/components/NotificationBell';
import { useTokens } from '@/theme/theme-context';

/**
 * THE SPORTS TEACHER'S TODAY — three figures and the three doors, in the
 * order the day runs: what is LIVE (the meet, tap to enter results), what is
 * WAITING on them (record attempts to verify), and where the houses stand.
 * Every figure opens the tab it counts; the desk's rights (`/sports/me`)
 * decide which verbs are drawn, the server decides which are allowed.
 */
export default function SportsToday() {
  const tokens = useTokens();
  const session = useSession();
  const me = useDeskMe();
  const meets = useQuery<TournamentRow[]>('/sports/tournaments');
  const records = useQuery<{ records: RecordView[]; pending: number }>('/sports/records');
  const houses = useQuery<HouseRow[]>('/sports/houses');

  const live = useMemo(() => (meets.data ?? []).filter((t) => t.status === 'LIVE'), [meets.data]);
  const upcoming = useMemo(() => (meets.data ?? []).filter((t) => t.status === 'DRAFT').slice(0, 3), [meets.data]);
  const table = useMemo(() => standings(houses.data ?? []), [houses.data]);
  const leader = table[0] ?? null;
  const loading = meets.loading || records.loading || houses.loading;
  const error = meets.error && !meets.data ? meets.error : null;
  const refresh = () => { meets.refresh(); records.refresh(); houses.refresh(); me.refresh(); };

  return (
    <Screen onRefresh={refresh} refreshing={meets.refreshing}>
      <SectionTitle title={session?.displayName ? `Hi, ${session.displayName.split(' ')[0]}` : 'Sports desk'} right={<NotificationBell group="(worker)" />} />
      <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 11.5, color: tokens.color.sub }}>Sports desk</Text>

      {error && <ErrorState error={error} onRetry={meets.reload} />}
      {loading && !error && <LoadingRows label="Opening the desk…" rows={3} />}

      {!loading && !error && (
        <>
          {/* THE HERO (9 Oct 2026): what is live, who leads, the desk's verbs. */}
          <RoleHero
            testID="desk-hero"
            quiet={live.length === 0}
            eyebrow="Sports desk"
            title={live.length ? `${live.length} ${live.length === 1 ? 'meet' : 'meets'} live` : 'No meet is live'}
            line={leader ? `${leader.name} lead the house table with ${leader.points} pts` : 'Houses appear once the office sets them up'}
            figures={[
              { testID: 'desk-live', value: String(live.length), label: 'live meets', onPress: () => router.push('/(worker)/(tabs)/meets') },
              { testID: 'desk-pending', value: String(records.data?.pending ?? 0), label: 'to verify', onPress: () => router.push('/(worker)/(tabs)/records') },
              { testID: 'desk-leader', value: leader ? leader.name : '—', label: leader ? `leading · ${leader.points} pts` : 'no houses', onPress: () => router.push('/(worker)/(tabs)/houses') },
            ]}
            actions={[
              { label: 'Meets', icon: 'sports', testID: 'hero-act-meets', onPress: () => router.push('/(worker)/(tabs)/meets') },
              { label: 'Records', icon: 'results', testID: 'hero-act-records', badge: records.data?.pending ?? 0, onPress: () => router.push('/(worker)/(tabs)/records') },
              { label: 'Houses', icon: 'assignments', testID: 'hero-act-houses', onPress: () => router.push('/(worker)/(tabs)/houses') },
              { label: 'Rules', icon: 'notes', testID: 'hero-act-rules', onPress: () => router.push('/(worker)/(tabs)/desk/rules') },
            ]}
          />

          <Page testID="desk-live-list">
            <PageHeader title="Running now" icon="sports" />
            {live.length === 0 ? (
              <Empty
                kind="first"
                icon="sports"
                title="No meet is live"
                action={can(me.data, 'CREATE') ? { label: 'Open Meets', onPress: () => router.push('/(worker)/(tabs)/meets'), testID: 'desk-open-meets' } : undefined}
              >
                {can(me.data, 'CREATE') ? 'Start one from Meets, or from the web desk for a big one.' : 'Nothing is running today.'}
              </Empty>
            ) : (
              live.map((t, i) => (
                <Row key={t.id} first={i === 0} testID={`desk-meet-${t.id}`} title={t.name} sub={`${formatDate(t.startsOn)} – ${formatDate(t.endsOn)} · ${t.events} event${t.events === 1 ? '' : 's'}`} right={<Pill tone={t.published ? 'green' : 'amber'}>{t.published ? 'Published' : 'Draft'}</Pill>} onPress={() => router.push(`/(worker)/(tabs)/meets/${t.id}`)} />
              ))
            )}
          </Page>

          {upcoming.length > 0 && (
            <Page>
              <PageHeader title="Coming up" icon="timetable" />
              {upcoming.map((t, i) => (
                <Row key={t.id} first={i === 0} title={t.name} sub={`from ${formatDate(t.startsOn)}`} onPress={() => router.push(`/(worker)/(tabs)/meets/${t.id}`)} />
              ))}
            </Page>
          )}

          {/* The rules book, which the web desk carries as its own section —
              the one part of the desk a teacher needs standing at the pit. */}
          <Page testID="desk-rules">
            <PageHeader title="Rules book" icon="notes" />
            <Row first title="How every sport is played" sub="Attempts, lets, ties, disqualifications" testID="desk-rules-open" onPress={() => router.push('/(worker)/(tabs)/desk/rules')} />
          </Page>

          {table.length > 0 && (
            <Page testID="desk-houses">
              <PageHeader title="House table" icon="assignments" />
              {table.slice(0, 4).map((h, i) => (
                <Row key={h.id} first={i === 0} title={`${h.place}. ${h.name}`} sub={`${h.members} member${h.members === 1 ? '' : 's'}`} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Swatch color={h.color} /><Text style={{ fontWeight: '700', color: tokens.color.ink }}>{h.points}</Text></View>} />
              ))}
            </Page>
          )}
        </>
      )}
    </Screen>
  );
}
