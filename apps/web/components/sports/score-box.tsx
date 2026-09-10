'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { judgeScores, type Scoring } from '@skoolos/types';
import { apiErrorCode, useDesk, type MatchRow, type TournamentDetail } from '@/app/app/sports/ui';
import { nameOf } from './model';

/**
 * The scoresheet under the bracket. It carries the match `version` it opened
 * with: if another desk saved first the API answers MATCH_CHANGED, the board
 * reloads and the teacher enters the score once more against what is now true.
 * Nothing is ever overwritten in silence.
 */
export function ScoreBox({ t, m, scoring, onClose }: { t: TournamentDetail; m: MatchRow; scoring: Scoring; onClose: () => void }) {
  const { api, host } = useDesk();
  const qc = useQueryClient();
  const slots = scoring.type === 'GAMES' ? scoring.bestOf : 2;
  const [a, setA] = useState<string[]>(() => pad(m.scoreA, slots));
  const [b, setB] = useState<string[]>(() => pad(m.scoreB, slots));
  useEffect(() => { setA(pad(m.scoreA, slots)); setB(pad(m.scoreB, slots)); }, [m.id, m.version, m.scoreA, m.scoreB, slots]);

  const arrays = () => trim(a, b);
  const verdict = (() => {
    const { scoreA, scoreB } = arrays();
    if (scoreA.length === 0) return { text: 'Enter the score, or give a walkover.', ok: true };
    const j = judgeScores(scoring, scoreA, scoreB);
    if (j.error === 'TIE_DECIDER') return { text: `Level — enter the ${scoring.type === 'SINGLE' ? scoring.decider.toLowerCase() : 'decider'} in the second box.`, ok: true };
    if (j.error) return { text: j.error === 'EXTRA_GAME' ? 'The match was already decided — remove the extra game.' : 'Not a legal score for this sport.', ok: false };
    if (j.winner) return { text: `${nameOf(t, j.winner === 'A' ? m.aSide : m.bSide)} wins.`, ok: true };
    return { text: 'In progress — saves as it stands.', ok: true };
  })();

  const save = useMutation({
    mutationFn: (body: { scoreA: number[]; scoreB: number[]; walkover?: 'A' | 'B' }) => api.post<{ version: number; winner: string | null; complete: boolean; finalBuilt: boolean }>(`/sports/matches/${m.id}/score`, { ...body, version: m.version }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sports-tournament', host, t.id] });
      toast.success(r.complete ? `Saved — ${nameOf(t, r.winner)} through.${r.finalBuilt ? ' The final is on the board.' : ''}` : 'Saved as it stands.');
      if (r.complete) onClose();
    },
    onError: (e) => {
      const code = apiErrorCode(e);
      qc.invalidateQueries({ queryKey: ['sports-tournament', host, t.id] });
      if (code === 'MATCH_CHANGED') toast.error('Someone else saved this match first. The board has reloaded — enter it again.');
      else if (code === 'MATCH_LOCKED') toast.error('The winner already played the next round. Clear that result first.');
      else toast.error((e as Error).message);
    },
  });

  const label = scoring.type === 'GAMES' ? scoring.label.replace(/s$/, '') : scoring.label;
  const decider = scoring.type === 'SINGLE' ? scoring.decider : 'Decider';
  return (
    <div className="sk-sp-scorebox" role="region" aria-label="Scoresheet">
      <div className="sk-sp-eventhead">
        <span className="nm">{m.roundName}{m.groupLabel !== 'Final' ? ` · ${m.groupLabel}` : ''}</span>
        <span className="sk-muted">{nameOf(t, m.aSide)} v {nameOf(t, m.bSide)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="sk-btn" data-size="sm" onClick={onClose}>Close</button>
      </div>
      <div className="sk-sp-games">
        {Array.from({ length: slots }, (_, i) => (
          <div key={i} className="sk-sp-game">
            <span className="sk-lab">{scoring.type === 'GAMES' ? `${label} ${i + 1}` : i === 0 ? scoring.label : decider}</span>
            <div className="pair">
              <input className="sk-input" inputMode="numeric" aria-label={`${nameOf(t, m.aSide)} ${scoring.type === 'GAMES' ? `${label} ${i + 1}` : i === 0 ? scoring.label : decider}`} value={a[i]} onChange={(e) => setA(a.map((x, j) => (j === i ? e.target.value : x)))} />
              <span className="sk-muted">–</span>
              <input className="sk-input" inputMode="numeric" aria-label={`${nameOf(t, m.bSide)} ${scoring.type === 'GAMES' ? `${label} ${i + 1}` : i === 0 ? scoring.label : decider}`} value={b[i]} onChange={(e) => setB(b.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
          </div>
        ))}
      </div>
      <p className="sk-muted" data-tone={verdict.ok ? undefined : 'bad'} style={verdict.ok ? undefined : { color: 'var(--sk-bad)' }}>{verdict.text}</p>
      <div className="sk-sp-actions">
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!verdict.ok || save.isPending} onClick={() => save.mutate(arrays())}>{save.isPending ? 'Saving…' : 'Save score'}</button>
        <button type="button" className="sk-btn" disabled={save.isPending} onClick={() => save.mutate({ scoreA: [], scoreB: [], walkover: 'A' })}>Walkover to {nameOf(t, m.aSide)}</button>
        <button type="button" className="sk-btn" disabled={save.isPending} onClick={() => save.mutate({ scoreA: [], scoreB: [], walkover: 'B' })}>Walkover to {nameOf(t, m.bSide)}</button>
        {m.winner ? <button type="button" className="sk-btn" disabled={save.isPending} onClick={() => save.mutate({ scoreA: [], scoreB: [] })}>Clear result</button> : null}
      </div>
    </div>
  );
}

function pad(n: number[], slots: number): string[] {
  return Array.from({ length: slots }, (_, i) => (n[i] == null ? '' : String(n[i])));
}

/** Strings → the two arrays, cut at the first empty pair; a half-filled pair counts as 0 for the missing side. */
function trim(a: string[], b: string[]): { scoreA: number[]; scoreB: number[] } {
  const scoreA: number[] = [];
  const scoreB: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].trim() === '' && b[i].trim() === '') break;
    scoreA.push(Number(a[i]) || 0);
    scoreB.push(Number(b[i]) || 0);
  }
  return { scoreA, scoreB };
}
