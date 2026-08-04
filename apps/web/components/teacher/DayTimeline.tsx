'use client';
import type { TeacherDayEntry } from '@skoolos/types';

export interface DayTimelineProps {
  entries: TeacherDayEntry[];
  /** Index of the current entry, or -1. Rows before it render dimmed. */
  currentIndex: number;
  onTakeAttendance: (classSectionId: string) => void;
}

/**
 * How a row READS, in the pitch's rail vocabulary: `now` wears the amber
 * "attention" wash, `free` the green one, and everything else stays on the
 * page. Deliberately separate from `dimmed` (which says "already gone") —
 * those are two different facts about a row and a row can carry both.
 */
function railTone(entry: TeacherDayEntry, isNow: boolean): 'now' | 'free' | undefined {
  if (isNow) return 'now';
  return entry.kind === 'FREE' ? 'free' : undefined;
}

function Row({
  entry,
  dimmed,
  isNow,
  onTakeAttendance,
}: {
  entry: TeacherDayEntry;
  dimmed: boolean;
  /** True for the single period happening right now — carries the amber wash. */
  isNow: boolean;
  onTakeAttendance: (classSectionId: string) => void;
}) {
  return (
    <div
      className="sk-row sk-timeline-row"
      data-dim={dimmed ? 'true' : 'false'}
      data-tone={railTone(entry, isNow)}
    >
      <span className="sk-timeline-time">
        {entry.startTime}–{entry.endTime}
      </span>
      {/* No decorative rule between the time and the entry: `.sk-row` lays
          this out as time-column → body → spacer → action, and slipping a
          fourth flex child in shifts every entry right of a fixed 92px time
          column for no information gain. The tone wash below is the whole of
          what this row needed — colour only, geometry untouched. */}
      <div style={{ minWidth: 0 }}>
        <div className="nm">
          {entry.kind === 'CLASS' && entry.slot
            ? `${entry.slot.className} · ${entry.slot.subjectName}`
            : entry.kind === 'FREE'
              ? 'Free period'
              : entry.label}
        </div>
      </div>
      <span className="sp" />
      {entry.kind === 'BREAK' && <span className="sk-muted">—</span>}
      {entry.kind === 'FREE' && (
        <span className="sk-pill" data-tone="good">
          Free
        </span>
      )}
      {entry.kind === 'CLASS' &&
        // Defensive, like NowCard's `register?.taken` handling: the real API
        // never pairs a CLASS row with a null register today, but if it ever
        // did, fall back to the "not marked" pill rather than rendering
        // nothing — a missing pill reads as "nothing to do here", which is
        // the wrong message for a class that hasn't had attendance taken.
        (entry.register?.taken ? (
          <span className="sk-pill" data-tone="good">
            ✓ {entry.register.present}/{entry.register.total}
          </span>
        ) : entry.slot ? (
          <button
            type="button"
            className="sk-pill"
            data-tone="warn"
            onClick={() => onTakeAttendance(entry.slot!.classSectionId)}
          >
            Not marked
          </button>
        ) : (
          <span className="sk-pill" data-tone="warn">
            Not marked
          </span>
        ))}
    </div>
  );
}

/**
 * The whole day, one row per timetable entry (classes and breaks alike).
 * Entries before `currentIndex` are grouped under "Earlier today" and
 * rendered dimmed; everything from the current entry onward reads as
 * upcoming. No hooks, no fetching — the page owns `currentIndex` so this
 * component is fully testable from props.
 */
export function DayTimeline({ entries, currentIndex, onTakeAttendance }: DayTimelineProps): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="sk-card">
        <div className="sk-card-b">
          <p className="sk-state">No periods scheduled today.</p>
        </div>
      </div>
    );
  }

  const splitAt = currentIndex > 0 ? currentIndex : 0;
  const earlier = entries.slice(0, splitAt);
  const rest = entries.slice(splitAt);

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>Today&apos;s timetable</h3>
      </div>
      <div className="sk-card-b">
        {earlier.length > 0 && (
          <>
            <p className="sk-lab">Earlier today</p>
            {earlier.map((e) => (
              <Row key={e.periodId} entry={e} dimmed isNow={false} onTakeAttendance={onTakeAttendance} />
            ))}
          </>
        )}
        {/* `splitAt` is where the current entry starts, so the live period is
            always the first row of `rest` — but only when there IS one
            (currentIndex === -1 means nothing is on, and highlighting the
            next period as "now" would be a lie). */}
        {rest.map((e, i) => (
          <Row
            key={e.periodId}
            entry={e}
            dimmed={false}
            isNow={currentIndex >= 0 && i === 0}
            onTakeAttendance={onTakeAttendance}
          />
        ))}
      </div>
    </div>
  );
}
