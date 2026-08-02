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

  if (entry.kind === 'BREAK' || entry.kind === 'FREE') {
    const isFree = entry.kind === 'FREE';
    return (
      <div className="sk-card sk-now" data-free={isFree ? 'true' : undefined}>
        <div className="sk-card-b">
          <p className="sk-eyebrow">Right now</p>
          <h2 className="sk-now-title">{isFree ? 'Free period' : entry.label}</h2>
          {/* No gradient and no live dot on a break or a free period: the
              hero paint means "you are teaching this right now", and a free
              slot is precisely the absence of that. Painting both the same
              way would cost the hero the only thing it says. */}
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

  // Past here `entry.kind` is CLASS, so `slot`/`register` are populated.
  const { slot, register } = entry;
  // A zero-length period can never be `currentEntry`'s pick (see
  // teacher-day.ts), but this component takes `total` as a plain prop and
  // must not assume its caller upheld that invariant — guard the division.
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;

  return (
    // The pitch's `.nowcard`: the live period is the only thing on the page
    // that is happening, so it stops being a card among cards and becomes the
    // saturated brand hero. `sk-card sk-now` are kept underneath it — the
    // layout and the page's own assertions hang off those; `sk-nowcard` only
    // repaints.
    <div className="sk-card sk-now sk-nowcard">
      <div className="sk-card-b">
        <p className="sk-eyebrow">
          {/* THE PULSE. A live period is a fact that changes while you look at
              it, and a static "Right now" label cannot say that. The dot is
              decoration in the strict sense — the words next to it carry the
              meaning — so it is `aria-hidden` and it stops moving entirely
              under prefers-reduced-motion (see `.sk-hero-dot`). */}
          <span className="sk-hero-dot" aria-hidden="true" />
          Right now
        </p>
        <h2 className="sk-now-title">{slot ? `${slot.className} · ${slot.subjectName}` : entry.label}</h2>
        {slot?.covering && <p className="sk-now-covering">Covering for {slot.coveringFor}</p>}

        {/* THE INK LINE. How far through the period you are, drawn rather than
            stated. `sk-inkline` grows it 0 → pct on mount; the real value is
            the inline width, so a reduced-motion user (or a failed animation)
            still sees the truth. The progressbar role carries the number for
            anyone who cannot see either. */}
        <div
          className="sk-nowprog"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Period progress"
        >
          <i className="sk-inkline" style={{ width: `${pct}%` }} />
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
              className="sk-btn sk-press"
              data-variant="primary"
              style={{ marginTop: 13 }}
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
