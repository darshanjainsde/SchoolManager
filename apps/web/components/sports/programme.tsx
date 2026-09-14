'use client';
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { dayOf, hhmm } from '@skoolos/types';
import { EmptyRow, Pill, dayOfMeet, fmtDay, type EventDetail, type TournamentDetail } from '@/app/app/sports/ui';
import { daySpanOf, eventLabel, slotsOf, type Slot } from './model';

export type Spine = 'sport' | 'category' | 'day';

/** How the office asks for the same rows, three ways. */
const SPINE_LABEL: Record<Spine, string> = { sport: 'Sport', category: 'Category', day: 'Day' };
const noun = (s: Spine, n: number) => (s === 'sport' ? (n === 1 ? 'sport' : 'sports') : s === 'category' ? (n === 1 ? 'category' : 'categories') : n === 1 ? 'day' : 'days');

export interface ProgrammeActions {
  /** Move one class's unplayed slots together. */
  moveGroup: (eventId: string, groupLabel: string, deltaMin: number) => void;
  /** Hold a whole branch to a day of the meet, or free it. */
  hold: (eventIds: string[], dayIdx: number | null) => void;
}

interface Row { slot: Slot; event: EventDetail }
interface Group { key: string; rows: Row[] }

const when = (startsOn: string, fromMin: number, toMin: number) => {
  const d1 = dayOf(fromMin);
  const d2 = dayOf(toMin - 1);
  const a = fmtDay(dayOfMeet(startsOn, d1));
  return d1 === d2 ? `${a} · ${hhmm(fromMin)} – ${hhmm(toMin)}` : `${a} ${hhmm(fromMin)} – ${fmtDay(dayOfMeet(startsOn, d2))} ${hhmm(toMin)}`;
};
const spanOf = (rows: Row[]) => ({ from: Math.min(...rows.map((r) => r.slot.atMin)), to: Math.max(...rows.map((r) => r.slot.atMin + r.slot.slotMin)) });

function groupBy(rows: Row[], key: (r: Row) => string): Group[] {
  const order: string[] = [];
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) { map.set(k, []); order.push(k); }
    map.get(k)!.push(r);
  }
  return order.map((k) => ({ key: k, rows: map.get(k)! }));
}

/**
 * The meet as a tree, hung whichever way the person asking needs it. The
 * badminton teacher wants every badminton together; the office printing the
 * programme wants Senior Boys together; the ground staff want Sunday. Same
 * rows, three orders — so the spine is a switch rather than a decision
 * somebody has to live with.
 *
 * A class row is the smallest thing worth moving as a unit, and its move
 * opens UNDER the row, not in a panel at the foot of the list.
 */
export function Programme({ t, canEdit, busy, act, onOpen }: {
  t: TournamentDetail; canEdit: boolean; busy: boolean; act: ProgrammeActions; onOpen: (slot: Slot) => void;
}) {
  const [spine, setSpine] = useState<Spine>('sport');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const days = daySpanOf(t).booked;

  const rows: Row[] = useMemo(() => slotsOf(t).map((slot) => ({ slot, event: slot.event })), [t]);
  const lv1 = (r: Row) => (spine === 'sport' ? r.event.sportName : spine === 'category' ? `${r.event.groupLabel} ${r.event.category}` : fmtDay(dayOfMeet(t.startsOn, dayOf(r.slot.atMin))));
  const lv2 = (r: Row) => (spine === 'sport' ? `${r.event.groupLabel} ${r.event.category}` : r.event.sportName);
  const tones = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of t.events) if (!m.has(e.sportKey)) m.set(e.sportKey, m.size % 8);
    return m;
  }, [t]);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const tree = groupBy(rows, lv1);
  const untimed = t.events.filter((e) => !rows.some((r) => r.event.id === e.id));

  if (!rows.length) return <EmptyRow>Nothing is timetabled yet.</EmptyRow>;
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-toolbar">
        <div className="sk-sp-spine" role="group" aria-label="Group the programme by">
          {(['sport', 'category', 'day'] as Spine[]).map((s) => (
            <button key={s} type="button" aria-pressed={spine === s} onClick={() => { setSpine(s); setOpen(new Set()); setEditing(null); }}>{SPINE_LABEL[s]}</button>
          ))}
        </div>
        <span className="sk-muted">{tree.length} {noun(spine, tree.length)} · {rows.length} matches and heats</span>
        <span className="sp" />
        <button type="button" className="sk-btn" data-size="sm" onClick={() => setOpen(open.size ? new Set() : new Set(tree.map((g) => g.key)))}>
          {open.size ? 'Shut every branch' : 'Open every branch'}
        </button>
      </div>

      <div className="sk-sp-schedule">
        {tree.map((g1) => {
          const o1 = open.has(g1.key);
          const s1 = spanOf(g1.rows);
          const eventIds = [...new Set(g1.rows.map((r) => r.event.id))];
          const held = eventIds.every((id) => t.events.find((e) => e.id === id)?.dayIdx != null);
          const holdKey = `hold:${g1.key}`;
          return (
            <section key={g1.key} className="sk-sp-sportrow" data-open={o1} data-tone={tones.get(g1.rows[0].event.sportKey) ?? 0} aria-label={g1.key}>
              <div className="hd-row">
                <button type="button" className="hd" aria-expanded={o1} onClick={() => toggle(g1.key)}>
                  <ChevronRight size={14} aria-hidden />
                  <span className="nm">{g1.key}</span>
                  <span className="meta">{g1.rows.length} · {[...new Set(g1.rows.map((r) => r.slot.venueId))].map((v) => t.venues.find((x) => x.id === v)?.name).filter(Boolean).join(', ')}</span>
                  <span className="sp" />
                  {held ? <Pill tone="brand">Held to a day</Pill> : null}
                  <span className="on">{when(t.startsOn, s1.from, s1.to)}</span>
                </button>
                {canEdit && spine !== 'day' ? (
                  <button type="button" className="sk-btn" data-size="sm" aria-expanded={editing === holdKey} onClick={() => setEditing(editing === holdKey ? null : holdKey)}>Runs on…</button>
                ) : null}
              </div>
              {editing === holdKey ? (
                <div className="sk-sp-movebox" role="group" aria-label={`Which days ${g1.key} runs on`}>
                  <span className="sk-lab">Hold {g1.key} to one day of the meet</span>
                  <div className="sk-sp-chips">
                    {Array.from({ length: days }, (_, i) => (
                      <button key={i} type="button" className="sk-chip" disabled={busy} onClick={() => { act.hold(eventIds, i); setEditing(null); }}>{fmtDay(dayOfMeet(t.startsOn, i), false)}</button>
                    ))}
                    <button type="button" className="sk-chip" disabled={busy} onClick={() => { act.hold(eventIds, null); setEditing(null); }}>Wherever it fits</button>
                  </div>
                  <p className="sk-muted">Every one of the {eventIds.length} event{eventIds.length === 1 ? '' : 's'} here is laid out on that day first; the rest of the meet fills in around it.</p>
                </div>
              ) : null}
              {o1 ? (
                <div className="body">
                  {groupBy(g1.rows, lv2).map((g2) => {
                    const k2 = `${g1.key}/${g2.key}`;
                    const o2 = open.has(k2);
                    const s2 = spanOf(g2.rows);
                    return (
                      <div key={k2} className="sk-sp-grouprow" data-open={o2}>
                        <button type="button" className="hd" aria-expanded={o2} onClick={() => toggle(k2)}>
                          <ChevronRight size={12} aria-hidden />
                          <span className="nm">{g2.key}</span>
                          <span className="meta">{g2.rows.length}</span>
                          <span className="sp" />
                          <span className="on">{when(t.startsOn, s2.from, s2.to)}</span>
                        </button>
                        {o2 ? groupBy(g2.rows, (r) => r.slot.group).map((g3) => {
                          const s3 = spanOf(g3.rows);
                          const playedAll = g3.rows.every((r) => r.slot.state === 'done');
                          const eventId = g3.rows[0].event.id;
                          const mk = `${k2}/${g3.key}`;
                          return (
                            <div key={mk} className="sk-sp-classrow">
                              <div className="line">
                                <span className="nm">{g3.key}</span>
                                <span className="meta">{g3.rows.length} · {[...new Set(g3.rows.map((r) => r.slot.venueId))].map((v) => t.venues.find((x) => x.id === v)?.name).filter(Boolean).join(', ')}</span>
                                <span className="sp" />
                                <span className="on">{when(t.startsOn, s3.from, s3.to)}</span>
                                {playedAll ? <span className="sk-sp-vbadge" data-tone="good">all played</span>
                                  : canEdit ? <button type="button" className="sk-btn" data-size="sm" aria-expanded={editing === mk} onClick={() => setEditing(editing === mk ? null : mk)}>Move…</button>
                                    : null}
                              </div>
                              {editing === mk ? (
                                <div className="sk-sp-movebox" role="group" aria-label={`Move ${g3.key}`}>
                                  <span className="sk-lab">Move {g3.rows.filter((r) => r.slot.state !== 'done').length} unplayed slot{g3.rows.filter((r) => r.slot.state !== 'done').length === 1 ? '' : 's'} of {g3.key}</span>
                                  <div className="sk-sp-chips">
                                    {[-60, -30, -15, 15, 30, 60, 120].map((d) => (
                                      <button key={d} type="button" className="sk-chip" disabled={busy}
                                        onClick={() => { act.moveGroup(eventId, g3.key, d); setEditing(null); }}>
                                        {d < 0 ? `${-d} min earlier` : `${d} min later`}
                                      </button>
                                    ))}
                                  </div>
                                  <p className="sk-muted">Anything already played stays where it happened. If the whole group will not fit, none of it moves and the reason says why.</p>
                                </div>
                              ) : null}
                              <ul className="slots">
                                {g3.rows.map((r) => (
                                  <li key={r.slot.id}>
                                    <button type="button" className="sk-sp-slotline" data-state={r.slot.state} onClick={() => onOpen(r.slot)}>
                                      <span className="t">{fmtDay(dayOfMeet(t.startsOn, dayOf(r.slot.atMin)), false)} {hhmm(r.slot.atMin)}</span>
                                      <span className="w">{r.slot.short}</span>
                                      <span className="who">{r.slot.who}</span>
                                      <span className="v">{t.venues.find((v) => v.id === r.slot.venueId)?.name}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        }) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {untimed.length ? <p className="sk-state">{untimed.length} event{untimed.length === 1 ? '' : 's'} not timetabled yet — {untimed.map(eventLabel).join(', ')}. See Days &amp; courts.</p> : null}
    </div>
  );
}
