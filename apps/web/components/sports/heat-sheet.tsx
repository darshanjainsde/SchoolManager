'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMark, parseMark, type MarkScoring } from '@skoolos/types';
import { Pill, useDesk, type HeatRow, type TournamentDetail } from '@/app/app/sports/ui';
import { nameOf, whenOf } from './model';

/**
 * One heat: a lane per row, a mark per lane. "Save" keeps what is typed;
 * "Save & rank" closes the heat — ranks it, checks every mark against the
 * Book of Records, and (for the last heat) builds the final.
 */
export function HeatSheet({ t, heat, scoring, canEnter, live }: { t: TournamentDetail; heat: HeatRow; scoring: MarkScoring; canEnter: boolean; live: boolean }) {
  const { api, host } = useDesk();
  const qc = useQueryClient();
  const venue = t.venues.find((v) => v.id === heat.venueId)?.name ?? null;
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    setText(Object.fromEntries(heat.marks.map((k) => [k.studentId, k.mark == null ? '' : formatMark(scoring, k.mark).replace(/ [a-z]+$/i, '')])));
  }, [heat.id, heat.marks, scoring]);

  const bad = heat.marks.filter((k) => text[k.studentId]?.trim() && parseMark(scoring, text[k.studentId]) == null).map((k) => nameOf(t, k.side));
  const save = useMutation({
    mutationFn: (done: boolean) => api.post<{ finalBuilt: boolean; attempts: number }>(`/sports/heats/${heat.id}/marks`, {
      done, marks: heat.marks.map((k) => ({ studentId: k.studentId, mark: text[k.studentId]?.trim() ? parseMark(scoring, text[k.studentId]) : null })),
    }),
    onSuccess: (r, done) => {
      qc.invalidateQueries({ queryKey: ['sports-tournament', host, t.id] });
      toast.success(done ? `Ranked.${r.attempts ? ` ${r.attempts} mark${r.attempts === 1 ? '' : 's'} sent to the record queue.` : ''}${r.finalBuilt ? ' The final is on the board.' : ''}` : 'Saved.');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const editable = canEnter && live;

  return (
    <div className="sk-sp-heat sk-sp-stack" style={{ gap: 8 }}>
      <div className="sk-sp-heathead">
        <b>{heat.kind === 'FINAL' ? 'Final' : `Heat ${heat.idx + 1}`}</b>
        {heat.done ? <Pill tone="good">Ranked</Pill> : <Pill tone="muted">Open</Pill>}
        <span className="sk-muted">{whenOf(heat.atMin)}{venue ? ` · ${venue}` : ''}</span>
      </div>
      <div className="sk-tblwrap">
        <table className="sk-tbl">
          <thead><tr><th>Lane</th><th>Athlete</th><th>{scoring.label} ({scoring.unit === 's' ? 'seconds or m:ss.xx' : scoring.unit})</th><th>Rank</th></tr></thead>
          <tbody>
            {heat.marks.map((k) => (
              <tr key={k.studentId}>
                <td>{k.lane}</td>
                <td>{nameOf(t, k.side)}</td>
                <td>{editable ? <input className="sk-input" inputMode="decimal" aria-label={`Mark for ${nameOf(t, k.side)}`} value={text[k.studentId] ?? ''} onChange={(e) => setText({ ...text, [k.studentId]: e.target.value })} /> : <span className="sk-sp-recval">{formatMark(scoring, k.mark)}</span>}</td>
                <td>{k.rank ?? (heat.done ? '—' : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bad.length ? <p style={{ color: 'var(--sk-bad)', fontSize: 13 }}>Not a mark: {bad.join(', ')}. Type seconds like 12.34, or 1:05.20; metres like 5.42.</p> : null}
      {editable ? (
        <div className="sk-sp-actions">
          <button type="button" className="sk-btn" disabled={bad.length > 0 || save.isPending} onClick={() => save.mutate(false)}>Save</button>
          <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={bad.length > 0 || save.isPending} onClick={() => save.mutate(true)}>{heat.done ? 'Save & re-rank' : 'Save & rank'}</button>
        </div>
      ) : null}
    </div>
  );
}
