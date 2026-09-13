'use client';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { dayOf, hhmm } from '@skoolos/types';
import { dayOfMeet, fmtDay, EmptyRow, Pill, type TournamentDetail } from '@/app/app/sports/ui';
import { scheduleOf, type ScheduleGroup, type ScheduleLine, type Slot } from './model';

/** "Sun 13 Sep 09:00 – 10:00", or the two dates when it runs across days. */
function when(startsOn: string, fromMin: number, toMin: number): string {
  const d1 = dayOf(fromMin);
  const d2 = dayOf(toMin - 1);
  const day1 = fmtDay(dayOfMeet(startsOn, d1));
  if (d1 === d2) return `${day1} · ${hhmm(fromMin)} – ${hhmm(toMin)}`;
  return `${day1} ${hhmm(fromMin)} – ${fmtDay(dayOfMeet(startsOn, d2))} ${hhmm(toMin)}`;
}

/**
 * The meet the way a teacher asks for it: by sport, then by the class or round
 * inside it. "When is the 100 m for class 9" is two presses, not a scroll
 * through seventy identical cards in start-time order.
 */
export function Schedule({ t, onOpen }: { t: TournamentDetail; onOpen: (slot: Slot) => void }) {
  const lines = scheduleOf(t);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const timetabled = lines.filter((l) => l.total > 0);

  if (!timetabled.length) return <EmptyRow>Nothing is timetabled yet.</EmptyRow>;
  return (
    <div className="sk-sp-schedule">
      <div className="sk-sp-classbar">
        <b>{timetabled.length} event{timetabled.length === 1 ? '' : 's'}</b>
        <span className="sk-muted">{timetabled.reduce((a, l) => a + l.total, 0)} matches and heats · {timetabled.reduce((a, l) => a + l.done, 0)} played</span>
        <span className="sp" />
        <button type="button" className="sk-btn" data-size="sm" onClick={() => setOpen(open.size ? new Set() : new Set(timetabled.map((l) => l.event.id)))}>
          {open.size ? 'Shut every sport' : 'Open every sport'}
        </button>
      </div>
      {timetabled.map((line) => (
        <SportRow key={line.event.id} t={t} line={line} open={open.has(line.event.id)} onToggle={() => toggle(line.event.id)} onOpen={onOpen} />
      ))}
      {lines.length > timetabled.length ? (
        <p className="sk-state">{lines.length - timetabled.length} event{lines.length - timetabled.length === 1 ? '' : 's'} not timetabled yet — see Days &amp; courts.</p>
      ) : null}
    </div>
  );
}

function SportRow({ t, line, open, onToggle, onOpen }: { t: TournamentDetail; line: ScheduleLine; open: boolean; onToggle: () => void; onOpen: (s: Slot) => void }) {
  const venues = line.venueIds.map((id) => t.venues.find((v) => v.id === id)?.name).filter(Boolean).join(', ');
  return (
    <section className="sk-sp-sportrow" data-open={open} data-tone={line.tone} aria-label={line.label}>
      <button type="button" className="hd" aria-expanded={open} onClick={onToggle}>
        <ChevronRight size={14} aria-hidden />
        <span className="nm">{line.label}</span>
        <span className="meta">{line.total} {line.event.kind === 'MATCH' ? 'matches' : 'heats'} · {venues || 'no venue'}</span>
        <span className="sp" />
        {line.done === line.total ? <Pill tone="good">All played</Pill> : line.done ? <Pill tone="brand">{line.done} of {line.total} played</Pill> : null}
        <span className="on">{line.fromMin != null && line.toMin != null ? when(t.startsOn, line.fromMin, line.toMin) : '—'}</span>
      </button>
      {open ? (
        <div className="body">
          {line.groups.map((g) => <GroupRow key={g.label} t={t} group={g} onOpen={onOpen} />)}
        </div>
      ) : null}
    </section>
  );
}

function GroupRow({ t, group, onOpen }: { t: TournamentDetail; group: ScheduleGroup; onOpen: (s: Slot) => void }) {
  const [open, setOpen] = useState(false);
  const venues = group.venueIds.map((id) => t.venues.find((v) => v.id === id)?.name).filter(Boolean).join(', ');
  return (
    <div className="sk-sp-grouprow" data-open={open}>
      <button type="button" className="hd" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden />
        <span className="nm">{group.label}</span>
        <span className="meta">{group.slots.length} · {venues}</span>
        <span className="sp" />
        <span className="on">{when(t.startsOn, group.fromMin, group.toMin)}</span>
      </button>
      {open ? (
        <ul className="slots">
          {group.slots.map((s) => (
            <li key={s.id}>
              <button type="button" className="sk-sp-slotline" data-state={s.state} onClick={() => onOpen(s)}>
                <span className="t">{fmtDay(dayOfMeet(t.startsOn, dayOf(s.atMin)), false)} {hhmm(s.atMin)}</span>
                <span className="w">{s.short}</span>
                <span className="who">{s.who}</span>
                <span className="v">{t.venues.find((v) => v.id === s.venueId)?.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
