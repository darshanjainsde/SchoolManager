'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AGE_GROUPS, DEFAULT_BANDS, validateBands, type Band } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, Pill, useDesk, type SettingsView } from './ui';

const STDS = Array.from({ length: 12 }, (_, i) => i + 1);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'band';

/**
 * One shared rulebook: how children are grouped (bands of classes, or the
 * School Games age groups), the points table, and whether publishing is the
 * admin's alone. The teacher with SETTINGS and the admin edit the same row.
 */
export default function SettingsTab({ base: _base }: { base: string }) {
  const { api, host, can, isAdmin } = useDesk();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sports-settings', host], enabled: !!host, queryFn: () => api.get<SettingsView>('/sports/settings') });
  const [draft, setDraft] = useState<SettingsView | null>(null);
  useEffect(() => { if (q.data && !draft) setDraft(q.data); }, [q.data, draft]);
  const save = useMutation({
    mutationFn: (d: SettingsView) => api.patch<SettingsView>('/sports/settings', d),
    onSuccess: (row) => { setDraft(row); qc.invalidateQueries({ queryKey: ['sports-settings'] }); toast.success('Saved — applies to the next tournament you create.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!draft) return <EmptyRow>Opening the settings…</EmptyRow>;
  const editable = can('SETTINGS');
  const problem = draft.grouping === 'BANDS' ? validateBands(draft.bands) : null;
  const patchBand = (i: number, p: Partial<Band>) => setDraft({ ...draft, bands: draft.bands.map((b, j) => (j === i ? { ...b, ...p } : b)) });

  return (
    <div className="sk-sp-stack">
      <Card>
        <CardHead>
          <h3>Grouping</h3>
          <p>Who competes with whom. A tournament keeps the grouping it was created with.</p>
        </CardHead>
        <CardBody>
          <div className="sk-seg">
            <button type="button" aria-pressed={draft.grouping === 'BANDS'} disabled={!editable} onClick={() => setDraft({ ...draft, grouping: 'BANDS' })}>Bands of classes</button>
            <button type="button" aria-pressed={draft.grouping === 'AGE'} disabled={!editable} onClick={() => setDraft({ ...draft, grouping: 'AGE' })}>Age groups (School Games)</button>
          </div>
          {draft.grouping === 'AGE' ? (
            <div className="sk-sp-kv">
              {AGE_GROUPS.map((g) => <div key={g.id}><b>{g.label}</b><span className="sk-muted">born on or after 1 January of the meet year − {g.under - 1}</span></div>)}
              <div><b>Needs</b><span className="sk-muted">a date of birth on every child’s record</span></div>
            </div>
          ) : (
            <div>
              {draft.bands.map((b, i) => (
                <div key={i} className="sk-sp-band">
                  <input className="sk-input" aria-label={`Band ${i + 1} name`} value={b.label} disabled={!editable} onChange={(e) => patchBand(i, { label: e.target.value, id: slug(e.target.value) })} />
                  <div className="sk-sp-stds" role="group" aria-label={`Classes in ${b.label}`}>
                    {STDS.map((n) => <button key={n} type="button" className="sk-chip" aria-pressed={b.stds.includes(n)} disabled={!editable} onClick={() => patchBand(i, { stds: b.stds.includes(n) ? b.stds.filter((x) => x !== n) : [...b.stds, n].sort((x, y) => x - y) })}>{n}</button>)}
                  </div>
                  {editable && draft.bands.length > 1 ? <button type="button" className="sk-btn" data-size="sm" onClick={() => setDraft({ ...draft, bands: draft.bands.filter((_, j) => j !== i) })}>Remove</button> : null}
                </div>
              ))}
              {editable ? (
                <div className="sk-sp-actions" style={{ paddingTop: 8 }}>
                  <button type="button" className="sk-btn" data-size="sm" disabled={draft.bands.length >= 6} onClick={() => setDraft({ ...draft, bands: [...draft.bands, { id: `band-${draft.bands.length + 1}`, label: `Band ${draft.bands.length + 1}`, stds: [] }] })}>Add a band</button>
                  <button type="button" className="sk-btn" data-size="sm" onClick={() => setDraft({ ...draft, bands: DEFAULT_BANDS })}>Reset to Sub-junior / Junior / Senior</button>
                </div>
              ) : null}
              {problem ? <p style={{ color: 'var(--sk-bad)', fontSize: 13 }}>{problem}</p> : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead><h3>House points</h3><p>What a placing, a match win and a class title are worth. Changing this does not rewrite points already on the table.</p></CardHead>
        <CardBody>
          <div className="sk-sp-field"><span className="sk-lab">Placings — 1st, 2nd, 3rd …</span>
            <div className="sk-sp-pointsrow">
              {draft.pointsPlacing.map((p, i) => <input key={i} className="sk-input" inputMode="numeric" aria-label={`Points for place ${i + 1}`} value={p} disabled={!editable} onChange={(e) => setDraft({ ...draft, pointsPlacing: draft.pointsPlacing.map((x, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : x)) })} />)}
              {editable ? <><button type="button" className="sk-btn" data-size="sm" disabled={draft.pointsPlacing.length >= 10} onClick={() => setDraft({ ...draft, pointsPlacing: [...draft.pointsPlacing, 0] })}>+ place</button><button type="button" className="sk-btn" data-size="sm" disabled={draft.pointsPlacing.length <= 1} onClick={() => setDraft({ ...draft, pointsPlacing: draft.pointsPlacing.slice(0, -1) })}>− place</button></> : null}
            </div>
          </div>
          <div className="sk-sp-fieldrow">
            <label className="sk-sp-field"><span className="sk-lab">A match win</span><input className="sk-input" inputMode="numeric" value={draft.pointsMatchWin} disabled={!editable} style={{ width: '6em' }} onChange={(e) => setDraft({ ...draft, pointsMatchWin: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="sk-sp-field"><span className="sk-lab">A class title</span><input className="sk-input" inputMode="numeric" value={draft.pointsClassWin} disabled={!editable} style={{ width: '6em' }} onChange={(e) => setDraft({ ...draft, pointsClassWin: Math.max(0, Number(e.target.value) || 0) })} /></label>
          </div>
          <p className="sk-muted">Points go to the house of the child who won. A section team (9 A v 9 B) carries no house, so team sports pay no house points.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHead><h3>Publishing</h3></CardHead>
        <CardBody>
          <label className="sk-sp-actions">
            <input type="checkbox" checked={draft.publishNeedsAdmin} disabled={!editable} onChange={(e) => setDraft({ ...draft, publishNeedsAdmin: e.target.checked })} />
            Only a school admin may publish a tournament to students
          </label>
          <p className="sk-muted">Off: a sports teacher with the Publish right may publish. Either way, a draft is never visible to students.</p>
        </CardBody>
      </Card>

      <div className="sk-sp-actions">
        {editable ? <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!!problem || save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? 'Saving…' : 'Save settings'}</button> : <Pill tone="muted">{isAdmin ? '' : 'Read-only — the Sports settings right is not on your desk.'}</Pill>}
      </div>
    </div>
  );
}
