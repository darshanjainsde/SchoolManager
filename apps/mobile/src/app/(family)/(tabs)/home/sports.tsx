import { Text, View } from 'react-native';
import { formatMark } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { nameOf, nextOf, ordinal, scoreline, slotMin, standingOf, when, type MeSportsEvent, type MeSportsPayload, type MeSportsTournament } from '@/lib/sports';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

type Student = Extract<MeSportsPayload, { role: 'STUDENT' }>;

/**
 * SPORTS — the child's own fixtures. The next one is the hero: on a meet day
 * the single most valuable pixel is where to stand and when. Then every
 * event grouped by SPORT, the noun a child says ("when is my 100 m?"), with
 * the meet named under it — a flat list in start-time order is the thing
 * the ledger tells us not to build. Bye and walkover say so in words; a
 * slot with no time yet says "to be announced", never 00:00.
 */
export default function Sports() {
  const tokens = useTokens();
  const q = useQuery<MeSportsPayload>('/me/sports');
  const d = q.data && q.data.role === 'STUDENT' ? (q.data as Student) : null;

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) && !q.data) {
    return (
      <Screen>
        <SectionTitle title="Sports" />
        <Page><Empty icon="sports">Sports isn’t switched on for your school yet.</Empty></Page>
      </Screen>
    );
  }

  const live = d ? d.tournaments.filter((t) => t.status !== 'DONE') : [];
  const nexts = live
    .flatMap((t) => t.events.map((e) => ({ t, e, n: nextOf(e) })).filter((x) => x.n))
    .sort((a, b) => (slotMin(a.n) ?? Infinity) - (slotMin(b.n) ?? Infinity));
  const first = nexts[0] ?? null;
  // "Red house" means little until it says 2nd with 42 points.
  const standing = d?.house ? standingOf(d.houses, d.house.id) : null;
  const mine = d?.house ? d.houses.find((h) => h.id === d.house!.id) : null;

  // Group by sport across meets; keep the meet's name on each row.
  const bySport = new Map<string, { t: MeSportsTournament; e: MeSportsEvent }[]>();
  for (const t of d?.tournaments ?? []) for (const e of t.events) bySport.set(e.sportName, [...(bySport.get(e.sportName) ?? []), { t, e }]);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Sports" />
      {q.loading && <LoadingRows label="Loading your fixtures…" rows={3} />}
      {q.error && !q.data && <ErrorState error={q.error} onRetry={q.reload} />}
      {d && (
        <>
          {first && (
            <View testID="sports-next" style={{ backgroundColor: tokens.color.indigo, borderRadius: 18, padding: 14, gap: 2 }}>
              <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: tokens.color.onBrand, opacity: 0.85 }}>Next up</Text>
              <Text style={{ fontFamily: font.serif, fontSize: 22, lineHeight: 27, fontWeight: '600', color: tokens.color.onBrand }}>
                {first.e.sportName} — {first.e.groupLabel} {first.e.category}
              </Text>
              <Text style={{ fontSize: 12.5, color: tokens.color.onBrand, opacity: 0.92, marginTop: 2 }}>
                {first.n!.kind === 'match'
                  ? `${first.n!.m.roundName}${first.n!.m.groupLabel !== 'Final' ? ` (${first.n!.m.groupLabel})` : ''} v ${nameOf(first.t, first.n!.m.aSide === first.e.side ? first.n!.m.bSide : first.n!.m.aSide)}`
                  : `${first.n!.h.kind === 'FINAL' ? 'Final' : `Heat ${first.n!.h.idx + 1}`}`}
              </Text>
              <Text style={{ fontSize: 12, color: tokens.color.onBrand, opacity: 0.85 }}>
                {when(first.t.startsOn, slotMin(first.n))}{(first.n!.kind === 'match' ? first.n!.m.venue : first.n!.h.venue) ? ` · ${first.n!.kind === 'match' ? first.n!.m.venue : first.n!.h.venue}` : ''}
              </Text>
              {first.n!.kind === 'heat' && (
                <View style={{ alignSelf: 'flex-start', marginTop: 8, backgroundColor: `${tokens.color.onBrand}2E`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: font.mono, fontSize: 11, fontWeight: '700', color: tokens.color.onBrand }}>LANE {first.n!.h.lane}</Text>
                </View>
              )}
            </View>
          )}

          {bySport.size === 0 && <Page><Empty icon="sports">No fixtures yet. They appear here once the sports desk publishes a meet.</Empty></Page>}

          {[...bySport.entries()].map(([sport, rows]) => (
            <Page key={sport}>
              <PageHeader title={sport} />
              {rows.map(({ t, e }, i) => {
                const n = nextOf(e);
                const played = e.matches.filter((m) => m.winner || m.scoreA.length);
                const done = e.heats.filter((h) => h.done);
                const bye = e.matches.some((m) => m.bye && (m.aSide === e.side || m.bSide === e.side)) && !e.matches.some((m) => m.winner);
                return (
                  <View key={e.eventId} testID={`event-${e.eventId}`} style={{ paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', color: tokens.color.ink }} numberOfLines={1}>
                        {e.groupLabel} {e.category}{/^[ckh]:/.test(e.side) ? ` · ${t.sideNames[e.side] ?? ''} team` : ''}
                      </Text>
                      {n ? <Pill tone="amber">{n.kind === 'match' ? 'Next' : n.h.kind === 'FINAL' ? 'Final' : `Heat ${n.h.idx + 1}`}</Pill> : bye ? <Pill tone="neutral">Bye</Pill> : null}
                    </View>
                    <Text style={{ fontSize: 11, color: tokens.color.sub }}>{t.name}</Text>
                    {n && <Text style={{ fontSize: 11.5, color: tokens.color.ink2 }}>{when(t.startsOn, slotMin(n))}{(n.kind === 'match' ? n.m.venue : n.h.venue) ? ` · ${n.kind === 'match' ? n.m.venue : n.h.venue}` : ''}{n.kind === 'heat' ? ` · lane ${n.h.lane}` : ''}</Text>}
                    {played.map((m) => {
                      const won = m.winner === e.side;
                      return (
                        <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                          <Pill tone={m.winner ? (won ? 'green' : 'red') : 'amber'}>{m.winner ? (won ? 'Won' : 'Lost') : 'Live'}</Pill>
                          <Text style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: tokens.color.ink2 }} numberOfLines={1}>
                            {m.roundName}{m.groupLabel !== 'Final' ? ` (${m.groupLabel})` : ''} v {nameOf(t, m.aSide === e.side ? m.bSide : m.aSide)} {scoreline(e, m)}
                          </Text>
                        </View>
                      );
                    })}
                    {done.map((h) => (
                      <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <Pill tone={h.rank === 1 ? 'green' : h.rank && h.rank <= 3 ? 'amber' : 'neutral'}>{h.rank ? ordinal(h.rank) : 'Ran'}</Pill>
                        <Text style={{ fontSize: 11.5, color: tokens.color.ink2 }}>
                          {h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`} · {e.scoring.type === 'MARK' ? formatMark(e.scoring, h.mark) : String(h.mark ?? '—')}
                        </Text>
                      </View>
                    ))}
                    {bye && !n && <Text style={{ fontSize: 11, color: tokens.color.sub }}>Bye in the first round — through without playing.</Text>}
                  </View>
                );
              })}
            </Page>
          ))}

          {(d.house || d.records.records.length > 0) && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {d.house && <Figure testID="sports-house" label="House" value={d.house.name} hint={standing && mine ? `${ordinal(standing.place)} of ${standing.of} · ${mine.points} pts` : undefined} />}
              {d.records.records.length > 0 && <Figure label="Records held" value={String(d.records.records.length)} hint="in the Book of Records" />}
            </View>
          )}

          {/* The house table — every house, points to date, mine in bold. */}
          {d.houses.length > 0 && (
            <Page testID="sports-houses">
              <PageHeader title="House table" />
              {[...d.houses].sort((a, b) => b.points - a.points).map((h, i) => {
                const own = h.id === d.house?.id;
                return (
                  <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
                    <Text style={{ width: 26, fontFamily: font.mono, fontSize: 11.5, color: tokens.color.sub }}>{ordinal(i + 1)}</Text>
                    <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: h.color }} />
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: own ? '700' : '500', color: tokens.color.ink }}>{h.name}</Text>
                    <Text style={{ fontSize: 11, color: tokens.color.sub }}>{h.members} members</Text>
                    <Text style={{ fontFamily: font.mono, fontSize: 13, fontWeight: '700', color: own ? tokens.color.indigo : tokens.color.ink }}>{h.points}</Text>
                  </View>
                );
              })}
            </Page>
          )}

          {/* The Book of Records — every record this child holds, as the web lists them. */}
          {d.records.records.length > 0 && (
            <Page testID="sports-records">
              <PageHeader title="Records I hold" />
              {d.records.records.map((r, i) => (
                <View key={r.id} style={{ paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: 14, fontWeight: '700', color: tokens.color.ink }}>{r.text}</Text>
                    <Pill tone={r.status === 'STANDING' || r.status === 'CURRENT' ? 'green' : 'neutral'}>{r.untilYear ? `${r.sinceYear}–${r.untilYear}` : `since ${r.sinceYear}`}</Pill>
                  </View>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>{r.sportName} · {r.category}</Text>
                </View>
              ))}
            </Page>
          )}
          {/* Attempts at a record — pending, ratified or not — the desk decides. */}
          {d.records.attempts.length > 0 && (
            <Page testID="sports-attempts">
              <PageHeader title="Record attempts" />
              {d.records.attempts.map((a, i) => (
                <View key={a.id} style={{ paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: 13.5, fontWeight: '600', color: tokens.color.ink }}>{a.text}</Text>
                    <Pill tone={a.status === 'APPROVED' || a.status === 'RATIFIED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{a.status.toLowerCase()}</Pill>
                  </View>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>{a.sportName} · {a.category}</Text>
                </View>
              ))}
            </Page>
          )}
        </>
      )}
    </Screen>
  );
}
