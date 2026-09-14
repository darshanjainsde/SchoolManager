'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayOfMeet, fmtDay } from '@/app/app/sports/ui';

/**
 * Days, at any number of them. A three-day meet wants chips — you see the
 * whole meet and press the one you want. A meet whose plan has spilled over
 * fifty days wants a stepper and a list: fifty chips is a wall you cannot read
 * and cannot aim at, which is exactly what it became.
 */
const CHIP_LIMIT = 7;

export function DayPicker({ startsOn, days, day, onDay }: {
  startsOn: string;
  days: { day: number; slots: number; beyond: boolean }[];
  day: number;
  onDay: (d: number) => void;
}) {
  if (days.length <= 1) return <span className="sk-muted">{fmtDay(startsOn)}</span>;
  const here = days.find((d) => d.day === day) ?? days[0];
  const at = days.indexOf(here);

  if (days.length <= CHIP_LIMIT) {
    return (
      <div className="sk-seg sk-sp-dayseg">
        {days.map((d) => (
          <button key={d.day} type="button" aria-pressed={d.day === day} data-beyond={d.beyond} onClick={() => onDay(d.day)}>
            {fmtDay(dayOfMeet(startsOn, d.day))}
            <span className="n">{d.slots || '—'}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="sk-sp-daypick">
      <button type="button" className="sk-btn" data-size="sm" data-icon="" aria-label="Previous day" disabled={at <= 0} onClick={() => onDay(days[at - 1].day)}><ChevronLeft size={14} /></button>
      <label className="sk-sp-field">
        <span className="sk-lab">Day {at + 1} of {days.length}</span>
        <select className="sk-input" aria-label="Day of the meet" value={day} onChange={(e) => onDay(Number(e.target.value))}>
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              {`${fmtDay(dayOfMeet(startsOn, d.day))} · ${d.slots ? `${d.slots} slot${d.slots === 1 ? '' : 's'}` : 'nothing on'}${d.beyond ? ' · not booked' : ''}`}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="sk-btn" data-size="sm" data-icon="" aria-label="Next day" disabled={at >= days.length - 1} onClick={() => onDay(days[at + 1].day)}><ChevronRight size={14} /></button>
      {here.beyond ? <span className="sk-sp-vbadge" data-tone="warn">Not booked</span> : null}
    </div>
  );
}
