'use client';
import type { TeacherDayEntry } from '@skoolos/types';

export interface DayTimelineProps {
  entries: TeacherDayEntry[];
  /** Index of the current entry, or -1. Rows before it render dimmed. */
  currentIndex: number;
  onTakeAttendance: (classSectionId: string) => void;
}

function Row({
  entry,
  dimmed,
  onTakeAttendance,
}: {
  entry: TeacherDayEntry;
  dimmed: boolean;
  onTakeAttendance: (classSectionId: string) => void;
}) {
  return (
    <div className="sk-row sk-timeline-row" data-dim={dimmed ? 'true' : 'false'}>
      <span className="sk-timeline-time">
        {entry.startTime}–{entry.endTime}
      </span>
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
              <Row key={e.periodId} entry={e} dimmed onTakeAttendance={onTakeAttendance} />
            ))}
          </>
        )}
        {rest.map((e) => (
          <Row key={e.periodId} entry={e} dimmed={false} onTakeAttendance={onTakeAttendance} />
        ))}
      </div>
    </div>
  );
}
