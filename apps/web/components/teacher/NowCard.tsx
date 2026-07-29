'use client';
import type { TeacherDayEntry } from '@skoolos/types';

export interface NowCardProps {
  entry: TeacherDayEntry | null;
  elapsed: number;
  total: number;
  /** Shown when nothing is current: before school, after school, or in a gap. */
  nextEntry: TeacherDayEntry | null;
  onTakeAttendance: (classSectionId: string) => void;
}

/** "8-A · Mathematics" for a class, or the period's own label ("Break") otherwise. */
function entryLabel(e: TeacherDayEntry): string {
  return e.kind === 'CLASS' && e.slot ? `${e.slot.className} · ${e.slot.subjectName}` : e.label;
}

/**
 * The teacher's "what's happening right now" tile. Pure presentational —
 * every state is driven entirely by props so it can be tested without a
 * network or a fake clock.
 *
 * Note on the null-entry states: `entry === null` covers three real
 * situations (before the first period, after the last, or a gap between
 * two), but these props carry no signal that distinguishes "before school"
 * from "a gap mid-day" — both just have some `nextEntry`. Rather than guess
 * and risk telling a teacher mid-morning that "school hasn't started",
 * both share one honest "nothing on right now" message; only the
 * no-`nextEntry` case (the day is genuinely over) gets distinct copy.
 */
export function NowCard({ entry, elapsed, total, nextEntry, onTakeAttendance }: NowCardProps): React.JSX.Element {
  if (!entry) {
    return (
      <div className="sk-card sk-now">
        <div className="sk-card-b">
          <p className="sk-eyebrow">Right now</p>
          {nextEntry ? (
            <>
              <h2 className="sk-now-title">Nothing on right now</h2>
              <p className="sk-now-sub">
                Next up: {entryLabel(nextEntry)} at {nextEntry.startTime}
              </p>
            </>
          ) : (
            <h2 className="sk-now-title">That&apos;s it for today</h2>
          )}
        </div>
      </div>
    );
  }

  if (entry.kind === 'BREAK') {
    return (
      <div className="sk-card sk-now">
        <div className="sk-card-b">
          <p className="sk-eyebrow">Right now</p>
          <h2 className="sk-now-title">{entry.label}</h2>
          {nextEntry ? (
            <p className="sk-now-sub">
              Next up: {entryLabel(nextEntry)} at {nextEntry.startTime}
            </p>
          ) : (
            <p className="sk-now-sub">Nothing scheduled after this.</p>
          )}
        </div>
      </div>
    );
  }

  const { slot, register } = entry;
  // A zero-length period can never be `currentEntry`'s pick (see
  // teacher-day.ts), but this component takes `total` as a plain prop and
  // must not assume its caller upheld that invariant — guard the division.
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;

  return (
    <div className="sk-card sk-now">
      <div className="sk-card-b">
        <p className="sk-eyebrow">Right now</p>
        <h2 className="sk-now-title">{slot ? `${slot.className} · ${slot.subjectName}` : entry.label}</h2>
        {slot?.covering && <p className="sk-now-covering">Covering for {slot.coveringFor}</p>}

        <div
          className="sk-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Period progress"
        >
          <div className="sk-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        {register?.taken ? (
          <div className="sk-now-done">
            <span className="sk-pill" data-tone="good">
              ✓ {register.present}/{register.total} present
            </span>
            {register.markedBy && <span className="sk-now-marker">Marked by {register.markedBy}</span>}
          </div>
        ) : (
          slot && (
            <button
              type="button"
              className="sk-btn"
              data-variant="primary"
              onClick={() => onTakeAttendance(slot.classSectionId)}
            >
              Take attendance
            </button>
          )
        )}
      </div>
    </div>
  );
}
