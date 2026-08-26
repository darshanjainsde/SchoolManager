'use client';
import type { PlannedSeat, SeatingRules } from '@skoolos/types';

/**
 * The floor, and the small amount of arithmetic that draws it.
 *
 * One component serves both steps. In step 1 a click takes a desk OUT of the
 * room; in step 2 the same cell holds a child and a click asks why they are
 * there. Keeping it one component is what guarantees the room the office drew
 * is the room it then sees seated — two grids would drift.
 */

export interface RoomShape {
  rows: number;
  cols: number;
  seatsPerDesk: number;
  removedDesks: string[];
}

export function deskKey(row: number, desk: number): string {
  return `${row}:${desk}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "R3·S07" — the same string the desk sticker, door list and chart all carry. */
export function seatCode(row: number, seat: number): string {
  return `R${row + 1}·S${pad2(seat + 1)}`;
}

/** Rows a child may sit in — the back row is spare while that rule is on. */
export function usableRows(room: RoomShape, backRowFree: boolean): number {
  return Math.max(1, room.rows - (backRowFree && room.rows > 1 ? 1 : 0));
}

/**
 * Seats a student can actually be put in. Mirrors `roomCapacity` in the API's
 * seating engine; the office needs the number as it types, before any request.
 */
export function capacityOf(room: RoomShape, backRowFree: boolean): number {
  const gone = new Set(room.removedDesks);
  let n = 0;
  for (let r = 0; r < usableRows(room, backRowFree); r++) {
    for (let c = 0; c < room.cols; c++) if (!gone.has(deskKey(r, c))) n += room.seatsPerDesk;
  }
  return n;
}

/** Desks the room actually has, ignoring whether they are in use this sitting. */
export function deskCount(room: RoomShape): number {
  const gone = new Set(room.removedDesks);
  let n = 0;
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) if (!gone.has(deskKey(r, c))) n++;
  }
  return n;
}

/**
 * Which seats sit next to a rule break.
 *
 * Re-derived on the client rather than sent down the wire. The API already
 * reports HOW MANY rules broke; this is the same fact placed on the floor, and
 * shipping a second copy of it is how the number and the highlight drift apart.
 */
export function clashesIn(
  seats: PlannedSeat[],
  rules: SeatingRules,
  classCount: number,
): Set<string> {
  const at = new Map(seats.map((s) => [`${s.row}:${s.seat}`, s]));
  const bad = new Set<string>();
  for (const s of seats) {
    for (const [dr, ds] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const) {
      const nb = at.get(`${s.row + dr}:${s.seat + ds}`);
      if (!nb) continue;
      const sameClass = nb.classSectionId === s.classSectionId;
      // With one class in the room, classmates sitting together is unavoidable
      // and the engine says so — flagging every seat red would be noise, not
      // information.
      if (rules.noClassmates && sameClass && classCount > 1) bad.add(`${s.row}:${s.seat}`);
      if (
        rules.spreadRolls &&
        sameClass &&
        nb.roll !== null &&
        s.roll !== null &&
        Math.abs(nb.roll - s.roll) <= 1
      ) {
        bad.add(`${s.row}:${s.seat}`);
      }
    }
  }
  return bad;
}

/** The one-sentence answer the office gives at the window. */
export function describeNeighbours(seat: PlannedSeat, seats: PlannedSeat[]): string {
  const at = new Map(seats.map((s) => [`${s.row}:${s.seat}`, s]));
  const around: [number, number, string][] = [
    [0, -1, 'on the left'],
    [0, 1, 'on the right'],
    [-1, 0, 'in front'],
    [1, 0, 'behind'],
  ];
  const bits: string[] = [];
  for (const [dr, ds, where] of around) {
    const nb = at.get(`${seat.row + dr}:${seat.seat + ds}`);
    if (!nb) continue;
    bits.push(`${nb.classLabel} ${where}${nb.classSectionId === seat.classSectionId ? ' — same class' : ''}`);
  }
  const first = seat.studentName.split(' ')[0];
  return bits.length ? `Around ${first}: ${bits.join(', ')}.` : 'No one is seated next to this desk.';
}

/** Class colour. Four tones, cycled — the label is in the seat too. */
export function toneFor(order: string[], classSectionId: string): string {
  const i = order.indexOf(classSectionId);
  return `c${((i < 0 ? 0 : i) % 4) + 1}`;
}

// ── the grid ─────────────────────────────────────────────────────────────────

export function RoomGrid({
  room,
  backRowFree,
  seats,
  classOrder,
  clashes,
  chosen,
  onToggleDesk,
  onPickSeat,
}: {
  room: RoomShape;
  backRowFree: boolean;
  /** Step 2 only. Absent means the room is being drawn, not seated. */
  seats?: PlannedSeat[];
  classOrder?: string[];
  clashes?: Set<string>;
  chosen?: string | null;
  onToggleDesk?: (row: number, desk: number) => void;
  onPickSeat?: (key: string) => void;
}) {
  const gone = new Set(room.removedDesks);
  const usable = usableRows(room, backRowFree);
  const at = new Map((seats ?? []).map((s) => [`${s.row}:${s.seat}`, s]));
  const editing = Boolean(onToggleDesk);

  return (
    <div className="sk-eh-floor" data-testid="room-floor">
      <div className="sk-eh-rows">
        {Array.from({ length: room.rows }, (_, row) => (
          <div className="sk-eh-rowline" key={row}>
            {Array.from({ length: room.cols }, (_, desk) => (
              <div className="sk-eh-desk" key={desk}>
                {Array.from({ length: room.seatsPerDesk }, (_, s) => {
                  const seat = desk * room.seatsPerDesk + s;
                  const key = `${row}:${seat}`;
                  const dead = gone.has(deskKey(row, desk));
                  const spare = row >= usable;
                  const who = at.get(key);
                  const state = dead ? 'gone' : who ? 'filled' : spare ? 'spare' : 'empty';
                  const clickable = editing || Boolean(who);

                  function act() {
                    if (onToggleDesk) onToggleDesk(row, desk);
                    else if (who && onPickSeat) onPickSeat(key);
                  }

                  return (
                    <div
                      key={s}
                      className="sk-eh-cell"
                      data-testid={`cell-${key}`}
                      data-state={state}
                      data-tone={who && classOrder ? toneFor(classOrder, who.classSectionId) : undefined}
                      data-clash={who && clashes?.has(key) ? 'true' : undefined}
                      data-chosen={chosen === key ? 'true' : undefined}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-label={
                        who
                          ? `${who.studentName}, ${who.classLabel}${who.roll !== null ? `, roll ${who.roll}` : ''}, ${seatCode(row, seat)}`
                          : `Row ${row + 1} desk ${desk + 1}${dead ? ', no desk' : ''}`
                      }
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                      onClick={act}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        act();
                      }}
                    >
                      {who ? (
                        <>
                          <b>{who.classLabel}</b>
                          <i>{who.roll ?? '—'}</i>
                        </>
                      ) : dead ? (
                        '×'
                      ) : spare ? (
                        'spare'
                      ) : editing ? (
                        seatCode(row, seat)
                      ) : (
                        ''
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
