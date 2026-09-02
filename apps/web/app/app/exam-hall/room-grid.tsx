'use client';
import { useRef, useState } from 'react';
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

/**
 * What a seat can actually fit.
 *
 * `classLabel` is "<Grade.name>-<section>", and Grade.name is usually the word
 * "Class" plus a number — so the seat was rendering "Class 10-A" in a 60px box
 * and crowding out the roll number. The full label still goes on every printed
 * sheet and into the accessible name; only the seat is abbreviated.
 */
export function shortLabel(classLabel: string): string {
  return classLabel.replace(/^\s*(class|grade|std\.?|standard)\s+/i, '');
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
  const seatsWide = room.cols * room.seatsPerDesk;

  // ROVING TABINDEX. Every desk used to be its own tab stop, so a keyboard user
  // had to press Tab past all of them — 54 in a normal hall and 1,200 in the
  // largest room the API will accept — before reaching the next control. The
  // grid is one stop now, and the arrow keys move inside it, which is the
  // standard pattern for a two-dimensional widget.
  const [cursor, setCursor] = useState({ row: 0, seat: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  function moveTo(row: number, seat: number) {
    const r = Math.max(0, Math.min(room.rows - 1, row));
    const c = Math.max(0, Math.min(seatsWide - 1, seat));
    setCursor({ row: r, seat: c });
    gridRef.current?.querySelector<HTMLElement>(`[data-testid="cell-${r}:${c}"]`)?.focus();
  }

  function onGridKey(e: React.KeyboardEvent) {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      moveTo(cursor.row + d[0], cursor.seat + d[1]);
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); moveTo(cursor.row, 0); }
    else if (e.key === 'End') { e.preventDefault(); moveTo(cursor.row, seatsWide - 1); }
  }

  return (
    <div className="sk-eh-floor" data-testid="room-floor">
      <div
        className="sk-eh-rows"
        ref={gridRef}
        role="grid"
        aria-label={editing ? 'Room layout — arrow keys move, Enter takes a desk out' : 'Seating chart — arrow keys move, Enter explains a seat'}
        onKeyDown={onGridKey}
      >
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
                  // A seated child wins over a removed desk. Editing the room
                  // clears the plan, so the two should never disagree — but if
                  // they ever do, the plan is the fact and painting "no desk"
                  // over somebody's name is the one unreadable outcome.
                  const state = who ? 'filled' : dead ? 'gone' : spare ? 'spare' : 'empty';
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
                      tabIndex={
                        clickable && cursor.row === row && cursor.seat === seat ? 0 : -1
                      }
                      onFocus={() => setCursor({ row, seat })}
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
                          <b>{shortLabel(who.classLabel)}</b>
                          <i>{who.roll ?? '—'}</i>
                        </>
                      ) : dead ? (
                        ''
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
      <p className="sk-eh-swipe">Swipe the room sideways to see every desk.</p>
    </div>
  );
}
