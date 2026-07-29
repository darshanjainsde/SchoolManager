'use client';
import type { GridShape } from '@/lib/timetable-grid';

const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export interface WeekGridProps {
  shape: GridShape;
  /** 1-7, or null when today is not a school day in this grid. */
  todayDayOfWeek: number | null;
  /** Period id happening right now, or null. */
  currentPeriodId: string | null;
}

/**
 * The week timetable as one grid — periods down the rows, days across the
 * columns — rather than the list-per-day layout `portal/timetable` used
 * before this. Shared between the teacher and (Phase 3) student portals: it
 * takes fully-shaped props and reads no clock and no network itself, so
 * `page.tsx` owns the "what time is it, what day is today" decision and this
 * component just renders whatever it's told.
 */
export function WeekGrid({ shape, todayDayOfWeek, currentPeriodId }: WeekGridProps): React.JSX.Element {
  const { periods, days, cells } = shape;

  return (
    <div className="sk-tt-wrap">
      <table className="sk-tt-table">
        <thead>
          <tr>
            <th className="sk-tt-day-th sk-tt-period-th" scope="col">
              Period
            </th>
            {days.map((day) => {
              const isToday = todayDayOfWeek !== null && day === todayDayOfWeek;
              return (
                <th
                  key={day}
                  scope="col"
                  className="sk-tt-day-th"
                  data-today={isToday ? 'true' : 'false'}
                  data-testid={`day-header-${day}`}
                >
                  {DAY_LABELS[day] ?? `Day ${day}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.id}>
              <th scope="row" className="sk-tt-period-cell">
                <div className="sk-tt-period-label">{period.label}</div>
                {(period.startTime || period.endTime) && (
                  <div className="sk-tt-period-time">
                    {period.startTime}
                    {period.startTime && period.endTime && ' – '}
                    {period.endTime}
                  </div>
                )}
              </th>
              {days.map((day) => {
                const isToday = todayDayOfWeek !== null && day === todayDayOfWeek;
                const slotEntry = cells.get(`${day}:${period.id}`);
                // The solid "current" fill is reserved for an actual class —
                // a free period during the current slot stays in its plain
                // dashed state (already visually distinct via .sk-tt-free)
                // rather than mixing "free" and "highlighted" signals on the
                // same cell.
                const isCurrent = isToday && currentPeriodId !== null && period.id === currentPeriodId && !!slotEntry;

                return (
                  <td
                    key={day}
                    className="sk-tt-td"
                    data-today={isToday ? 'true' : 'false'}
                    data-testid={`cell-${day}-${period.id}`}
                  >
                    {slotEntry ? (
                      <div className="sk-tt-cell" data-current={isCurrent ? 'true' : 'false'}>
                        <div className="cls">{slotEntry.className}</div>
                        <div className="subj">{slotEntry.subjectName}</div>
                      </div>
                    ) : (
                      <div
                        className="sk-tt-cell sk-tt-free"
                        data-current={isCurrent ? 'true' : 'false'}
                        aria-label="Free period"
                      >
                        <span className="sk-tt-free-label">Free</span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
