'use client';
import { dayOf, formatMark, hhmm } from '@skoolos/types';
import type { MeSportsEvent, MeSportsHouse, MeSportsPayload, MeSportsTournament } from '@/lib/sports-me-types';

/**
 * The child's sports tab — pure, so the screen audit can render it with the
 * longest real values. The page owns the query and the refusal states.
 *
 * Order: what is next (the hero — on a meet day the one pixel that matters
 * is where to stand and when), then every event grouped by SPORT, the noun a
 * child says ("when is my 100 m?"), each with its meet named under it. A
 * flat list in start-time order is the thing the ledger says not to build,
 * and the app already groups this way — the web now matches it. The house
 * table, the records held and the finished meets sit in the side column.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function when(startsOn: string, atMin: number | null): string {
  if (atMin == null) return 'time to follow';
  const d = new Date(Date.parse(`${startsOn}T00:00:00Z`) + dayOf(atMin) * 86_400_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hhmm(atMin)}`;
}
/** '2026-09-19'..'2026-09-21' → '19 – 21 Sep 2026'; across months → '28 Sep – 2 Oct 2026'; one day → '19 Sep 2026'. */
export function meetDates(t: { startsOn: string; endsOn: string }): string {
  const a = new Date(`${t.startsOn}T00:00:00Z`);
  const b = new Date(`${t.endsOn}T00:00:00Z`);
  const md = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (t.startsOn === t.endsOn) return `${md(a)} ${a.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${a.getUTCDate()} – ${md(b)} ${b.getUTCFullYear()}`;
  return `${md(a)} – ${md(b)} ${b.getUTCFullYear()}`;
}
const nameOf = (t: MeSportsTournament, side: string | null) => (side ? (t.sideNames[side] ?? side) : 'to be decided');
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

type Match = MeSportsEvent['matches'][number];
type Heat = MeSportsEvent['heats'][number];
type Next = { kind: 'match'; m: Match } | { kind: 'heat'; h: Heat };

/** "Next" for an event: the first unplayed match I am in with both sides known, or my first open heat. */
export function nextOf(e: MeSportsEvent): Next | null {
  const m = e.matches.find((x) => !x.winner && !x.bye && x.aSide && x.bSide);
  if (m) return { kind: 'match', m };
  const h = e.heats.find((x) => !x.done);
  if (h) return { kind: 'heat', h };
  return null;
}
const slotMin = (n: Next | null) => (n ? (n.kind === 'match' ? n.m.atMin : n.h.atMin) : null);
const venueOf = (n: Next) => (n.kind === 'match' ? n.m.venue : n.h.venue);
const opponent = (t: MeSportsTournament, e: MeSportsEvent, m: Match) => nameOf(t, m.aSide === e.side ? m.bSide : m.aSide);
const roundOf = (m: Match) => `${m.roundName}${m.groupLabel !== 'Final' ? ` (${m.groupLabel})` : ''}`;
const heatName = (h: Heat) => (h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`);
const nextLine = (t: MeSportsTournament, e: MeSportsEvent, n: Next) => (n.kind === 'match' ? `${roundOf(n.m)} v ${opponent(t, e, n.m)}` : `${heatName(n.h)}, lane ${n.h.lane}`);

export function scoreline(e: MeSportsEvent, m: Match): string {
  const mine = m.aSide === e.side ? m.scoreA : m.scoreB;
  const theirs = m.aSide === e.side ? m.scoreB : m.scoreA;
  if (!mine.length) return m.walkover ? 'walkover' : '';
  return e.scoring.type === 'GAMES' ? mine.map((x, i) => `${x}-${theirs[i]}`).join(' ') : mine.length > 1 ? `${mine[0]}-${theirs[0]} (${mine[1]}-${theirs[1]})` : `${mine[0]}-${theirs[0]}`;
}

/** Where my house stands: houses sorted by points, ties share a place. */
export function standingOf(houses: MeSportsHouse[], id: string): { place: number; of: number } | null {
  if (!houses.length) return null;
  const sorted = [...houses].sort((a, b) => b.points - a.points);
  const i = sorted.findIndex((h) => h.id === id);
  if (i < 0) return null;
  const place = sorted.findIndex((h) => h.points === sorted[i].points) + 1;
  return { place, of: sorted.length };
}

export function SportsView({ d }: { d: MeSportsPayload }) {
  if (d.role === 'TEACHER') return <TeacherView d={d} />;

  const live = d.tournaments.filter((t) => t.status !== 'DONE');
  const past = d.tournaments.filter((t) => t.status === 'DONE');
  const nexts = live
    .flatMap((t) => t.events.map((e) => ({ t, e, n: nextOf(e) })).filter((x): x is { t: MeSportsTournament; e: MeSportsEvent; n: Next } => !!x.n))
    .sort((a, b) => (slotMin(a.n) ?? Infinity) - (slotMin(b.n) ?? Infinity));
  const first = nexts[0] ?? null;
  const standing = d.house ? standingOf(d.houses, d.house.id) : null;
  const mine = d.house ? d.houses.find((h) => h.id === d.house!.id) : null;

  // Group by sport across meets; keep the meet's name on each row.
  const bySport = new Map<string, { t: MeSportsTournament; e: MeSportsEvent }[]>();
  for (const t of d.tournaments) for (const e of t.events) bySport.set(e.sportName, [...(bySport.get(e.sportName) ?? []), { t, e }]);
  const hasRecords = d.records.records.length > 0 || d.records.attempts.length > 0;

  return (
    <div className="ps-page" data-testid="sports-page">
      <header className="sk-pagehead">
        <div className="who">
          <h1>Your sports</h1>
          <div className="meta" data-testid="sports-standing">
            {d.house
              ? standing && mine
                ? `${d.house.name} house · ${ordinal(standing.place)} of ${standing.of} · ${mine.points} points`
                : `${d.house.name} house`
              : 'No house yet'}
            {d.tournaments.length ? ` · ${d.tournaments.length === 1 ? '1 meet' : `${d.tournaments.length} meets`}` : ''}
          </div>
        </div>
        {d.house ? (
          <span className="ps-house">
            <span className="ps-dot" style={{ background: d.house.color }} aria-hidden="true" />
            {d.house.name} house
          </span>
        ) : null}
      </header>

      {first ? (
        <section className="sk-card ps-next" data-testid="sports-next">
          <div className="sk-card-b">
            <div className="sk-lab">Up next</div>
            <div className="t">
              {first.e.sportName} — {first.e.groupLabel} {first.e.category}
            </div>
            <div className="v">{nextLine(first.t, first.e, first.n)}</div>
            <div className="w">
              {when(first.t.startsOn, slotMin(first.n))}
              {venueOf(first.n) ? ` · ${venueOf(first.n)}` : ''}
            </div>
            {nexts.length > 1 ? (
              <div className="ps-more">
                {nexts.slice(1, 3).map(({ t, e, n }) => (
                  <div key={e.eventId} className="ps-line">
                    <span>
                      <b>{e.sportName}</b> {e.groupLabel} {e.category} — {nextLine(t, e, n)}
                    </span>
                    <span className="w">
                      {when(t.startsOn, slotMin(n))}
                      {venueOf(n) ? ` · ${venueOf(n)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="ps-cols">
        <div className="ps-main">
          {bySport.size === 0 ? (
            <section className="sk-card">
              <div className="sk-card-b">
                <p className="sk-state" data-testid="sports-empty">
                  You are not entered in a tournament yet. When the sports desk enters you, your fixtures and results appear here.
                </p>
              </div>
            </section>
          ) : (
            <div className="ps-sports">
              {[...bySport.entries()].map(([sport, rows]) => (
                <section className="sk-card" key={sport} data-testid={`sport-${sport}`}>
                  <div className="sk-card-h">
                    <h3>{sport}</h3>
                    <span className="sk-pill" data-tone="neutral">{rows.length === 1 ? '1 event' : `${rows.length} events`}</span>
                  </div>
                  <div className="sk-card-b">
                    {rows.map(({ t, e }) => {
                      const n = nextOf(e);
                      const played = e.matches.filter((m) => m.winner || m.scoreA.length);
                      const done = e.heats.filter((h) => h.done);
                      const bye = e.matches.some((m) => m.bye && (m.aSide === e.side || m.bSide === e.side)) && !e.matches.some((m) => m.winner);
                      return (
                        <div className="ps-ev" key={e.eventId} data-testid={`event-${e.eventId}`}>
                          <div className="hd">
                            <span className="t">
                              {e.groupLabel} {e.category}
                              {/^[ckh]:/.test(e.side) ? ` · ${t.sideNames[e.side] ?? ''} team` : ''}
                            </span>
                            {n ? (
                              <span className="sk-pill" data-tone="warn">{n.kind === 'match' ? 'Next' : heatName(n.h)}</span>
                            ) : bye ? (
                              <span className="sk-pill" data-tone="neutral">Bye</span>
                            ) : t.status === 'DONE' ? (
                              <span className="sk-pill" data-tone="neutral">Finished</span>
                            ) : null}
                          </div>
                          <div className="meet">
                            {t.name} · {meetDates(t)}
                          </div>
                          {n ? (
                            <div className="when">
                              {nextLine(t, e, n)} · {when(t.startsOn, slotMin(n))}
                              {venueOf(n) ? ` · ${venueOf(n)}` : ''}
                            </div>
                          ) : null}
                          {played.map((m) => {
                            const won = m.winner === e.side;
                            return (
                              <div className="ps-line" key={m.id}>
                                <span className="sk-pill" data-tone={m.winner ? (won ? 'good' : 'bad') : 'warn'}>{m.winner ? (won ? 'Won' : 'Lost') : 'Live'}</span>
                                <span>
                                  {roundOf(m)} v {opponent(t, e, m)} <span className="ps-score">{scoreline(e, m)}</span>
                                </span>
                              </div>
                            );
                          })}
                          {done.map((h) => (
                            <div className="ps-line" key={h.id}>
                              <span className="sk-pill" data-tone={h.rank === 1 ? 'good' : h.rank && h.rank <= 3 ? 'warn' : 'neutral'}>{h.rank ? ordinal(h.rank) : 'Ran'}</span>
                              <span>
                                {heatName(h)}: {e.scoring.type === 'MARK' ? formatMark(e.scoring, h.mark) : String(h.mark ?? '—')}
                              </span>
                            </div>
                          ))}
                          {bye && !n ? <div className="meet">Bye in the first round — through without playing.</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="ps-side">
          {d.houses.length ? <HouseTable houses={d.houses} mineId={d.house?.id ?? null} /> : null}

          {hasRecords ? (
            <section className="sk-card" data-testid="sports-records">
              <div className="sk-card-h">
                <h3>Your records</h3>
              </div>
              <div className="sk-card-b">
                <div className="pl-rows">
                  {d.records.records.map((r) => (
                    <div className="ps-rec" key={r.id}>
                      <div className="b">
                        <div className="t">
                          {r.sportName} <span style={{ color: 'var(--sk-ink-3)', fontWeight: 400 }}>{r.category}</span>
                        </div>
                        <div className="m">{r.status === 'STANDING' || r.status === 'CURRENT' ? `School record since ${r.sinceYear}` : `Held ${r.sinceYear}–${r.untilYear}`}</div>
                      </div>
                      <div className="n">{r.text}</div>
                    </div>
                  ))}
                  {d.records.attempts.map((a) => (
                    <div className="ps-rec" key={a.id}>
                      <div className="b">
                        <div className="t">
                          {a.sportName} <span style={{ color: 'var(--sk-ink-3)', fontWeight: 400 }}>{a.category}</span>
                        </div>
                        <div className="m">{a.status === 'PENDING' ? 'Waiting to be verified' : a.status === 'REJECTED' ? 'Not ratified' : 'Ratified'}</div>
                      </div>
                      <div className="n">{a.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {past.length ? (
            <section className="sk-card" data-testid="sports-past">
              <div className="sk-card-h">
                <h3>Finished meets</h3>
              </div>
              <div className="sk-card-b">
                <div className="pl-rows">
                  {past.map((t) => (
                    <div className="pl-row" key={t.id}>
                      <div className="b">
                        <div className="t">{t.name}</div>
                        <div className="m">{t.events.length === 1 ? '1 event' : `${t.events.length} events`}</div>
                      </div>
                      <div className="r">{meetDates(t)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function HouseTable({ houses, mineId }: { houses: MeSportsHouse[]; mineId: string | null }) {
  const sorted = [...houses].sort((a, b) => b.points - a.points);
  return (
    <section className="sk-card ps-houses" data-testid="sports-houses">
      <div className="sk-card-h">
        <h3>House table</h3>
      </div>
      <div className="sk-card-b">
        <div className="pl-rows">
          {sorted.map((h, i) => (
            <div className="row" key={h.id} data-mine={h.id === mineId ? 'true' : undefined}>
              <span className="rk">{ordinal(i + 1)}</span>
              <span className="ps-dot" style={{ background: h.color }} aria-hidden="true" />
              <span className="nm">{h.name}</span>
              <span className="mem">{h.members} members</span>
              <span className="pts">{h.points}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TeacherView({ d }: { d: Extract<MeSportsPayload, { role: 'TEACHER' }> }) {
  return (
    <div className="ps-page" data-testid="sports-page">
      <header className="sk-pagehead">
        <div className="who">
          <h1>Sports</h1>
          <div className="meta">{d.tournaments.length ? `${d.tournaments.length === 1 ? '1 meet' : `${d.tournaments.length} meets`} published` : 'Nothing published yet'}</div>
        </div>
      </header>
      <div className="ps-cols">
        <section className="sk-card">
          <div className="sk-card-h">
            <h3>Tournaments</h3>
          </div>
          <div className="sk-card-b">
            {d.tournaments.length === 0 ? (
              <p className="sk-state">No tournament published yet.</p>
            ) : (
              <div className="pl-rows">
                {d.tournaments.map((t) => (
                  <div className="pl-row" key={t.id}>
                    <div className="b">
                      <div className="t">{t.name}</div>
                      <div className="m">{meetDates(t)}</div>
                    </div>
                    <span className="sk-pill" data-tone={t.status === 'LIVE' ? 'good' : t.status === 'DONE' ? 'neutral' : 'warn'}>{t.status === 'LIVE' ? 'live' : t.status === 'DONE' ? 'finished' : 'draft'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        {d.houses.length ? <HouseTable houses={d.houses} mineId={null} /> : (
          <section className="sk-card"><div className="sk-card-b"><p className="sk-state">No houses yet.</p></div></section>
        )}
      </div>
    </div>
  );
}
