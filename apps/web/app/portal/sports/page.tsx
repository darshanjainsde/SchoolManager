'use client';
import { useQuery } from '@tanstack/react-query';
import { dayOf, formatMark, hhmm } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeSportsEvent, MeSportsPayload, MeSportsTournament } from '@/lib/sports-me-types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(startsOn: string, atMin: number | null): string {
  if (atMin == null) return 'time to follow';
  const d = new Date(Date.parse(`${startsOn}T00:00:00Z`) + dayOf(atMin) * 86_400_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hhmm(atMin)}`;
}
const nameOf = (t: MeSportsTournament, side: string | null) => (side ? t.sideNames[side] ?? side : 'to be decided');

/** "Next" for an event: the first unplayed match I am in with both sides known, or my first open heat. */
function nextOf(e: MeSportsEvent) {
  const m = e.matches.find((x) => !x.winner && !x.bye && x.aSide && x.bSide);
  if (m) return { kind: 'match' as const, m };
  const h = e.heats.find((x) => !x.done);
  if (h) return { kind: 'heat' as const, h };
  return null;
}

function scoreline(e: MeSportsEvent, m: MeSportsEvent['matches'][number]): string {
  const mine = m.aSide === e.side ? m.scoreA : m.scoreB;
  const theirs = m.aSide === e.side ? m.scoreB : m.scoreA;
  if (!mine.length) return m.walkover ? 'walkover' : '';
  return e.scoring.type === 'GAMES' ? mine.map((x, i) => `${x}-${theirs[i]}`).join(' ') : mine.length > 1 ? `${mine[0]}-${theirs[0]} (${mine[1]}-${theirs[1]})` : `${mine[0]}-${theirs[0]}`;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/**
 * The child's sports tab: what is next for me (first, big), how I did, my
 * house, the records I hold. Teachers see the published meets and the table.
 */
export default function PortalSportsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({ queryKey: ['me-sports', host], enabled: !!host, retry: false, queryFn: () => api.get<MeSportsPayload>('/me/sports') });

  if (q.error instanceof ApiError && q.error.status === 403) {
    return <div className="mx-auto max-w-md py-12 text-center text-sm text-[var(--sk-ink-3)]">🏅 Sports isn&rsquo;t part of your school&rsquo;s plan yet.</div>;
  }
  if (q.isLoading || !q.data) return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Checking the day board…</p>;
  const d = q.data;

  if (d.role === 'TEACHER') {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <h1 className="text-xl font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>Sports</h1>
        <Section title="Tournaments">
          {d.tournaments.length === 0 ? <Empty>No tournament published yet.</Empty> : d.tournaments.map((t) => <Row key={t.id} primary={t.name} secondary={`${t.startsOn}${t.endsOn !== t.startsOn ? ` – ${t.endsOn}` : ''} · ${t.status === 'LIVE' ? 'live' : t.status === 'DONE' ? 'finished' : 'draft'}`} />)}
        </Section>
        <Section title="House table">
          {d.houses.length === 0 ? <Empty>No houses yet.</Empty> : [...d.houses].sort((a, b) => b.points - a.points).map((h) => <Row key={h.id} primary={<span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: h.color }} />{h.name}</span>} secondary={`${h.members} members`} right={<b>{h.points}</b>} />)}
        </Section>
      </div>
    );
  }

  const live = d.tournaments.filter((t) => t.status !== 'DONE');
  const past = d.tournaments.filter((t) => t.status === 'DONE');
  const nexts = live.flatMap((t) => t.events.map((e) => ({ t, e, n: nextOf(e) })).filter((x) => x.n)).sort((a, b) => (slotMin(a) ?? Infinity) - (slotMin(b) ?? Infinity));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>Your sports</h1>
        {d.house ? <span className="flex items-center gap-1.5 rounded-full border border-[var(--sk-line)] px-3 py-1 text-xs font-semibold text-[var(--sk-ink-2)]"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.house.color }} />{d.house.name} house</span> : null}
      </div>

      {nexts.length ? (
        <div className="rounded-xl border border-[var(--sk-brand)] bg-[var(--sk-brand-tint)] px-3.5 py-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--sk-brand-2)]">Up next</div>
          {nexts.slice(0, 3).map(({ t, e, n }) => (
            <div key={e.eventId} className="mt-1.5 text-sm text-[var(--sk-ink)]">
              <b>{e.sportName}</b> {e.groupLabel} {e.category} — {n!.kind === 'match' ? `${n!.m.roundName}${n!.m.groupLabel !== 'Final' ? ` (${n!.m.groupLabel})` : ''} v ${nameOf(t, n!.m.aSide === e.side ? n!.m.bSide : n!.m.aSide)}` : `${n!.h.kind === 'FINAL' ? 'Final' : `Heat ${n!.h.idx + 1}`}, lane ${n!.h.lane}`}
              <div className="text-xs text-[var(--sk-ink-2)]">{when(t.startsOn, n!.kind === 'match' ? n!.m.atMin : n!.h.atMin)}{(n!.kind === 'match' ? n!.m.venue : n!.h.venue) ? ` · ${n!.kind === 'match' ? n!.m.venue : n!.h.venue}` : ''}</div>
            </div>
          ))}
        </div>
      ) : null}

      {d.tournaments.length === 0 ? <Empty>You are not entered in a tournament yet. When the sports teacher enters you, your fixtures and results appear here.</Empty> : null}

      {[...live, ...past].map((t) => (
        <Section key={t.id} title={t.name} sub={`${t.startsOn}${t.endsOn !== t.startsOn ? ` – ${t.endsOn}` : ''}${t.status === 'DONE' ? ' · finished' : ''}`}>
          {t.events.map((e) => (
            <div key={e.eventId} className="border-t border-[var(--sk-line)] py-2 first:border-t-0">
              <div className="text-sm font-semibold text-[var(--sk-ink)]">{e.sportName} <span className="font-normal text-[var(--sk-ink-3)]">{e.groupLabel} {e.category}{/^[ckh]:/.test(e.side) ? ` · ${t.sideNames[e.side] ?? ''} team` : ''}</span></div>
              {e.matches.filter((m) => m.winner || m.scoreA.length).map((m) => {
                const won = m.winner === e.side;
                return <div key={m.id} className="mt-1 flex items-center gap-2 text-xs text-[var(--sk-ink-2)]"><span className={`rounded-full px-2 py-0.5 font-bold ${m.winner ? (won ? 'bg-[var(--sk-good-tint)] text-[var(--sk-good)]' : 'bg-[var(--sk-bad-tint)] text-[var(--sk-bad)]') : 'bg-[var(--sk-amber-tint)] text-[var(--sk-amber-ink)]'}`}>{m.winner ? (won ? 'W' : 'L') : 'live'}</span><span>{m.roundName}{m.groupLabel !== 'Final' ? ` (${m.groupLabel})` : ''} v {nameOf(t, m.aSide === e.side ? m.bSide : m.aSide)} {scoreline(e, m)}</span></div>;
              })}
              {e.heats.filter((h) => h.done).map((h) => (
                <div key={h.id} className="mt-1 flex items-center gap-2 text-xs text-[var(--sk-ink-2)]"><span className="rounded-full bg-[var(--sk-brand-tint)] px-2 py-0.5 font-bold text-[var(--sk-brand-2)]">{h.rank ? ordinal(h.rank) : '—'}</span><span>{h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}: {e.scoring.type === 'MARK' ? formatMark(e.scoring, h.mark) : String(h.mark ?? '—')}</span></div>
              ))}
              {e.matches.some((m) => m.bye && (m.aSide === e.side || m.bSide === e.side)) && !e.matches.some((m) => m.winner) ? <div className="mt-1 text-xs text-[var(--sk-ink-3)]">Bye in the first round.</div> : null}
            </div>
          ))}
        </Section>
      ))}

      {d.records.records.length || d.records.attempts.length ? (
        <Section title="Your records">
          {d.records.records.map((r) => <Row key={r.id} primary={<>{r.sportName} <span className="text-[var(--sk-ink-3)]">{r.category}</span></>} secondary={r.status === 'STANDING' ? `School record since ${r.sinceYear}` : `Held ${r.sinceYear}–${r.untilYear}`} right={<b className="font-mono">{r.text}</b>} />)}
          {d.records.attempts.filter((a) => a.status === 'PENDING').map((a) => <Row key={a.id} primary={<>{a.sportName} <span className="text-[var(--sk-ink-3)]">{a.category}</span></>} secondary="Waiting to be verified" right={<b className="font-mono">{a.text}</b>} />)}
        </Section>
      ) : null}
    </div>
  );
}

function slotMin(x: { n: ReturnType<typeof nextOf> }): number | null {
  if (!x.n) return null;
  return x.n.kind === 'match' ? x.n.m.atMin : x.n.h.atMin;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--sk-line)] bg-[var(--sk-card)] px-3.5 py-3">
      <h2 className="text-sm font-semibold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>{title}</h2>
      {sub ? <p className="text-xs text-[var(--sk-ink-3)]">{sub}</p> : null}
      <div className="mt-1">{children}</div>
    </section>
  );
}
function Row({ primary, secondary, right }: { primary: React.ReactNode; secondary?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-[var(--sk-line)] py-2 first:border-t-0">
      <div className="min-w-0 flex-1"><div className="text-sm text-[var(--sk-ink)]">{primary}</div>{secondary ? <div className="text-xs text-[var(--sk-ink-3)]">{secondary}</div> : null}</div>
      {right}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-[var(--sk-ink-3)]">{children}</p>;
}
