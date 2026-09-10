'use client';
import { roundName as roundNameOf, type Scoring } from '@skoolos/types';
import type { EventDetail, MatchRow, TournamentDetail } from '@/app/app/sports/ui';
import { fmtDay, dayOfMeet } from '@/app/app/sports/ui';
import { groupsOf, nameOf, sideScore, whenOf } from './model';
import { dayOf } from '@skoolos/types';

/**
 * A knockout as columns of rounds. A card is a button when the desk may score
 * it; a bye is dashed; a decided match is tinted. The winner's name is bold on
 * the card AND carried into the next column, so the eye can follow a line.
 */
export function Bracket({ t, event, selectedId, canScore, onSelect }: { t: TournamentDetail; event: EventDetail; selectedId: string | null; canScore: boolean; onSelect: (m: MatchRow) => void }) {
  const venueName = new Map(t.venues.map((v) => [v.id, v.name]));
  const groups = groupsOf(event);
  if (groups.length === 0) return <p className="sk-state">No draw yet.</p>;
  return (
    <div className="sk-sp-stack">
      {groups.map((g) => {
        const rounds = Math.max(...g.matches.map((m) => m.roundIdx)) + 1;
        return (
          <div key={g.key}>
            <p className="sk-lab" style={{ marginBottom: 6 }}>{g.label}{g.label !== 'Final' ? ' round' : ''}</p>
            <div className="sk-sp-bracket">
              {Array.from({ length: rounds }, (_, r) => (
                <div key={r} className="sk-sp-round">
                  <span className="sk-lab">{roundNameOf(r, rounds)}</span>
                  {g.matches.filter((m) => m.roundIdx === r).sort((a, b) => a.pos - b.pos).map((m) => (
                    <MatchCard key={m.id} t={t} m={m} scoring={event.scoring} venue={m.venueId ? venueName.get(m.venueId) ?? null : null} selected={selectedId === m.id} canScore={canScore} onSelect={onSelect} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchCard({ t, m, scoring, venue, selected, canScore, onSelect }: { t: TournamentDetail; m: MatchRow; scoring: Scoring; venue: string | null; selected: boolean; canScore: boolean; onSelect: (m: MatchRow) => void }) {
  const state = m.winner ? 'done' : m.scoreA.length ? 'live' : 'open';
  const ready = !m.bye && !!m.aSide && !!m.bSide;
  const day = m.atMin != null && t.endsOn !== t.startsOn ? `${fmtDay(dayOfMeet(t.startsOn, dayOf(m.atMin)), false)} ` : '';
  return (
    <button type="button" className="sk-sp-match" data-state={state} data-bye={m.bye} aria-pressed={selected} disabled={!canScore || !ready} onClick={() => onSelect(m)} aria-label={`${m.roundName}: ${nameOf(t, m.aSide)} v ${nameOf(t, m.bSide)}`}>
      <Side name={nameOf(t, m.aSide)} score={sideScore(scoring, m.scoreA, m.scoreB)} win={!!m.winner && m.winner === m.aSide} empty={!m.aSide} />
      <Side name={m.bye ? 'Bye' : nameOf(t, m.bSide)} score={sideScore(scoring, m.scoreB, m.scoreA)} win={!!m.winner && m.winner === m.bSide} empty={!m.bSide} />
      {!m.bye ? <span className="sk-sp-slot">{m.walkover ? <span>Walkover</span> : null}<span>{day}{whenOf(m.atMin)}</span>{venue ? <span>· {venue}</span> : null}</span> : null}
    </button>
  );
}

function Side({ name, score, win, empty }: { name: string; score: string; win: boolean; empty: boolean }) {
  return (
    <span className="sk-sp-side" data-win={win} data-empty={empty}>
      <span className="n">{name}</span>
      <span className="s">{score}</span>
    </span>
  );
}
