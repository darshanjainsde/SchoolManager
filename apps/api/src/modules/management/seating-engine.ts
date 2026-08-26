/**
 * The seating engine.
 *
 * Pure functions only — no Prisma, no Nest, no clock, no randomness beyond the
 * seed it is handed. Everything it needs arrives as arguments, so the whole
 * thing is unit-testable and the same inputs always rebuild the same hall.
 *
 * FOUR RULES, and they are all a school ever asked for:
 *
 *   noClassmates   classmates never sit adjacent — left, right, front or back
 *   alternateCols  columns alternate between the two grades in the room, so a
 *                  neighbour is always writing a different paper
 *   spreadRolls    consecutive roll numbers in one class are never adjacent
 *   backRowFree    the last row stays empty so the teacher can stand behind
 *
 * TWO OF THEM CAN GENUINELY FIGHT. If a grade has only one section in the
 * room, `alternateCols` forces those students into the same columns, so some
 * of them MUST sit one behind another. Side by side still gets a different
 * paper — which is the copying risk that actually matters — so the column rule
 * wins and the report says plainly what happened. The alternative (silently
 * emitting violations) is how a seating chart loses a school's trust.
 */

export interface SeatingClass {
  /** ClassSection id. */
  id: string;
  /** "9-A" — what the office and the printed slip both call it. */
  label: string;
  /** 9, 10 … the paper a student in this section will write. */
  grade: number;
  students: SeatingStudent[];
}

export interface SeatingStudent {
  id: string;
  name: string;
  /** Roll within the section. Null for a student with no roll recorded. */
  roll: number | null;
}

export interface SeatingRoom {
  rows: number;
  cols: number;
  seatsPerDesk: number;
  /** "row:col", 0-based. */
  removedDesks: string[];
}

export interface SeatingRules {
  noClassmates: boolean;
  alternateCols: boolean;
  spreadRolls: boolean;
  backRowFree: boolean;
}

export const DEFAULT_RULES: SeatingRules = {
  noClassmates: true,
  alternateCols: true,
  spreadRolls: true,
  backRowFree: true,
};

/** One placed student. `seat` is the position across the whole row, 0-based. */
export interface PlannedSeat {
  row: number;
  seat: number;
  /** Desk this seat belongs to (two seats share a desk when seatsPerDesk is 2). */
  desk: number;
  /** "R3·S07" — the code printed on the desk sticker and the door list. */
  code: string;
  studentId: string;
  studentName: string;
  classSectionId: string;
  classLabel: string;
  roll: number | null;
}

export interface SeatingReport {
  /** Seats a student could actually be put in, after removed desks and the back row. */
  capacity: number;
  seated: number;
  /** Students with no seat in this room — they need another one. */
  unseated: number;
  /** Adjacent pairs that break a rule that was switched on. Aim: zero. */
  clashes: number;
  /** Placements the generator had to bend to seat everyone. */
  bent: number;
  /** Plain sentences for the office. Rendered as-is; never assembled in the UI. */
  notes: string[];
}

export interface SeatingResult {
  seats: PlannedSeat[];
  report: SeatingReport;
  seed: number;
}

// ── grid helpers ─────────────────────────────────────────────────────────────

function seatsPerRow(room: SeatingRoom): number {
  return room.cols * room.seatsPerDesk;
}

/** Rows a student may be placed in — the back row is spare when the rule is on. */
function usableRows(room: SeatingRoom, rules: SeatingRules): number {
  return Math.max(1, room.rows - (rules.backRowFree && room.rows > 1 ? 1 : 0));
}

function deskOf(seat: number, room: SeatingRoom): number {
  return Math.floor(seat / room.seatsPerDesk);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function seatCode(row: number, seat: number): string {
  return `R${row + 1}·S${pad2(seat + 1)}`;
}

export function roomCapacity(room: SeatingRoom, rules: SeatingRules): number {
  const gone = new Set(room.removedDesks);
  let n = 0;
  for (let r = 0; r < usableRows(room, rules); r++) {
    for (let d = 0; d < room.cols; d++) {
      if (!gone.has(`${r}:${d}`)) n += room.seatsPerDesk;
    }
  }
  return n;
}

/**
 * Deterministic PRNG. `Math.random()` would make a reprint a different hall,
 * which is the one thing a seating chart must never be.
 */
function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ── which grade owns which column ────────────────────────────────────────────

/**
 * Column parity → grade. Two things decide it, and both have bitten:
 *
 *   * `[9, 10].sort()` in JavaScript is LEXICOGRAPHIC and returns [10, 9].
 *   * The bigger cohort must get the parity with MORE columns, or students
 *     spill out of their own columns and every spill reads as a broken rule.
 *
 * Null when the room holds a single grade — the rule cannot mean anything then.
 */
function gradePlan(classes: SeatingClass[], room: SeatingRoom): number[] | null {
  const size = new Map<number, number>();
  for (const c of classes) size.set(c.grade, (size.get(c.grade) ?? 0) + c.students.length);
  const grades = [...size.keys()].sort((a, b) => a - b);
  if (grades.length < 2) return null;
  if (grades.length > 2) return grades;

  const evens = Math.ceil(seatsPerRow(room) / 2);
  const odds = Math.floor(seatsPerRow(room) / 2);
  const [g1, g2] = grades;
  const big = (size.get(g1) ?? 0) >= (size.get(g2) ?? 0) ? g1 : g2;
  const small = big === g1 ? g2 : g1;
  return evens >= odds ? [big, small] : [small, big];
}

/** The section that is alone in its column parity, if there is one. */
function loneSection(classes: SeatingClass[], plan: number[] | null): string | null {
  if (!plan) return null;
  const byParity = new Map<number, SeatingClass[]>();
  for (const c of classes) {
    const p = plan.indexOf(c.grade);
    if (p < 0) continue;
    byParity.set(p, [...(byParity.get(p) ?? []), c]);
  }
  for (const group of byParity.values()) {
    if (group.length === 1) return group[0].label;
  }
  return null;
}

// ── generation ───────────────────────────────────────────────────────────────

interface Slot {
  row: number;
  seat: number;
  desk: number;
  dead: boolean;
  spare: boolean;
  who: (SeatingStudent & { cls: SeatingClass }) | null;
  clash: boolean;
}

interface Ctx {
  room: SeatingRoom;
  rules: SeatingRules;
  plan: number[] | null;
  soloRoom: boolean;
  soloCol: string | null;
}

function index(row: number, seat: number, room: SeatingRoom): number {
  return row * seatsPerRow(room) + seat;
}

function neighbours(row: number, seat: number, room: SeatingRoom, grid: Slot[]): Slot[] {
  const spr = seatsPerRow(room);
  const out: Slot[] = [];
  if (seat > 0) out.push(grid[index(row, seat - 1, room)]);
  if (seat < spr - 1) out.push(grid[index(row, seat + 1, room)]);
  if (row > 0) out.push(grid[index(row - 1, seat, room)]);
  if (row < room.rows - 1) out.push(grid[index(row + 1, seat, room)]);
  return out.filter(Boolean);
}

type Break = 'classmate' | 'roll' | 'column' | null;

function breaksRule(
  cand: SeatingStudent & { cls: SeatingClass },
  row: number,
  seat: number,
  grid: Slot[],
  ctx: Ctx,
): Break {
  const { room, rules, plan, soloRoom, soloCol } = ctx;

  for (const nb of neighbours(row, seat, room, grid)) {
    const other = nb.who;
    if (!other) continue;
    const beside = nb.row === row;

    // `soloCol`: this grade has one section in the room, so front/back is
    // unavoidable. Side by side is still a different paper, which is the case
    // that matters, so only that one is enforced.
    if (rules.noClassmates && !soloRoom && other.cls.id === cand.cls.id && (beside || !soloCol)) {
      return 'classmate';
    }
    // Roll numbers only mean something inside one class. 9-A roll 8 and 9-B
    // roll 9 are unrelated children; comparing them invents clashes.
    if (
      rules.spreadRolls &&
      other.cls.id === cand.cls.id &&
      other.roll !== null &&
      cand.roll !== null &&
      Math.abs(other.roll - cand.roll) <= 1
    ) {
      return 'roll';
    }
  }

  if (rules.alternateCols && plan && cand.cls.grade !== plan[seat % plan.length]) return 'column';
  return null;
}

function buildGrid(room: SeatingRoom, rules: SeatingRules): Slot[] {
  const gone = new Set(room.removedDesks);
  const spr = seatsPerRow(room);
  const ur = usableRows(room, rules);
  const grid: Slot[] = [];
  for (let row = 0; row < room.rows; row++) {
    for (let seat = 0; seat < spr; seat++) {
      const desk = deskOf(seat, room);
      grid.push({
        row,
        seat,
        desk,
        dead: gone.has(`${row}:${desk}`),
        spare: row >= ur,
        who: null,
        clash: false,
      });
    }
  }
  return grid;
}

/** Column-major snake: the order the alternate-column rule is built around. */
function fillOrder(room: SeatingRoom, rules: SeatingRules): number[] {
  const spr = seatsPerRow(room);
  const ur = usableRows(room, rules);
  const order: number[] = [];
  for (let seat = 0; seat < spr; seat++) {
    for (let step = 0; step < ur; step++) {
      const row = seat % 2 === 0 ? step : ur - 1 - step;
      order.push(index(row, seat, room));
    }
  }
  return order;
}

function attempt(
  classes: SeatingClass[],
  room: SeatingRoom,
  rules: SeatingRules,
  seed: number,
): { grid: Slot[]; clashes: number; bent: number; seated: number } {
  const plan = gradePlan(classes, room);
  const ctx: Ctx = {
    room,
    rules,
    plan,
    soloRoom: classes.length === 1,
    soloCol: loneSection(classes, plan),
  };

  const rand = mulberry32(seed);
  // One pool per class, shuffled, so two runs of the same room are not the
  // same students in the same desks.
  const pools = classes.map((cls) => {
    const arr = cls.students.map((s) => ({ ...s, cls }));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  const grid = buildGrid(room, rules);
  const order = fillOrder(room, rules);

  let seatsLeft = order.filter((i) => !grid[i].dead).length;
  let left = pools.reduce((n, p) => n + p.length, 0);
  let seated = 0;
  let bent = 0;

  for (const i of order) {
    const slot = grid[i];
    if (slot.dead) continue;
    seatsLeft--;
    if (!left) continue;

    let best: { p: number; q: number } | null = null;
    let bestSize = -1;
    let fallback: { p: number; q: number } | null = null;
    let fallbackSize = -1;

    for (let p = 0; p < pools.length; p++) {
      if (!pools[p].length) continue;
      const q = pools[p].findIndex((s) => !breaksRule(s, slot.row, slot.seat, grid, ctx));
      if (q >= 0 && pools[p].length > bestSize) {
        best = { p, q };
        bestSize = pools[p].length;
      }
      if (pools[p].length > fallbackSize) {
        fallback = { p, q: 0 };
        fallbackSize = pools[p].length;
      }
    }

    if (!best) {
      // A room bigger than the roster leaves desks empty rather than breaking a
      // rule to fill them. Bending is only ever to seat someone who otherwise
      // would not get a desk at all.
      if (seatsLeft >= left) continue;
      if (!fallback) continue;
      bent++;
      slot.who = pools[fallback.p].splice(fallback.q, 1)[0];
      seated++;
      left--;
      continue;
    }

    slot.who = pools[best.p].splice(best.q, 1)[0];
    seated++;
    left--;
  }

  // Nobody is ever silently dropped: anyone still standing takes the next
  // empty desk, and the bend is counted so the report can say so.
  if (left) {
    for (const i of order) {
      if (!left) break;
      const slot = grid[i];
      if (slot.dead || slot.who) continue;
      const pool = pools.find((p) => p.length);
      if (!pool) break;
      slot.who = pool.shift()!;
      seated++;
      left--;
      bent++;
    }
  }

  // Score what actually came out, independently of how it was built.
  let clashes = 0;
  const counted = new Set<string>();
  for (let i = 0; i < grid.length; i++) {
    const slot = grid[i];
    if (!slot.who) continue;
    for (const nb of neighbours(slot.row, slot.seat, room, grid)) {
      if (!nb.who) continue;
      const j = index(nb.row, nb.seat, room);
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (counted.has(key)) continue;
      const beside = nb.row === slot.row;
      let bad = false;
      if (
        rules.noClassmates &&
        !ctx.soloRoom &&
        nb.who.cls.id === slot.who.cls.id &&
        (beside || !ctx.soloCol)
      ) {
        bad = true;
      } else if (
        rules.spreadRolls &&
        nb.who.cls.id === slot.who.cls.id &&
        nb.who.roll !== null &&
        slot.who.roll !== null &&
        Math.abs(nb.who.roll - slot.who.roll) <= 1
      ) {
        bad = true;
      }
      if (bad) {
        counted.add(key);
        clashes++;
        slot.clash = true;
        nb.clash = true;
      }
    }
    if (rules.alternateCols && ctx.plan && slot.who.cls.grade !== ctx.plan[slot.seat % ctx.plan.length]) {
      clashes++;
      slot.clash = true;
    }
  }

  return { grid, clashes, bent, seated };
}

/**
 * Generates a seating chart.
 *
 * A single greedy pass can paint itself into a corner, so a handful of seeds
 * are tried and the cleanest hall wins. Still fully deterministic: the same
 * `seed` in gives the same chart out, which is what makes a reprint safe.
 */
export function generateSeating(
  classes: SeatingClass[],
  room: SeatingRoom,
  rules: SeatingRules = DEFAULT_RULES,
  seed = 11,
): SeatingResult {
  const withStudents = classes.filter((c) => c.students.length > 0);
  const total = withStudents.reduce((n, c) => n + c.students.length, 0);
  const capacity = roomCapacity(room, rules);

  if (!withStudents.length || capacity === 0) {
    return {
      seats: [],
      report: {
        capacity,
        seated: 0,
        unseated: total,
        clashes: 0,
        bent: 0,
        notes: [
          capacity === 0
            ? 'This room has no usable desks. Add desks, or turn off "back row stays empty".'
            : 'No classes are ticked for this room.',
        ],
      },
      seed,
    };
  }

  let best: ReturnType<typeof attempt> | null = null;
  let bestSeed = seed;
  for (let i = 0; i < 24; i++) {
    const trySeed = (seed + i * 101) % 9973;
    const run = attempt(withStudents, room, rules, trySeed);
    if (
      !best ||
      run.clashes < best.clashes ||
      (run.clashes === best.clashes && run.bent < best.bent)
    ) {
      best = run;
      bestSeed = trySeed;
    }
    if (best.clashes === 0 && best.bent === 0) break;
  }

  const grid = best!.grid;
  const seats: PlannedSeat[] = grid
    .filter((s) => s.who)
    .map((s) => ({
      row: s.row,
      seat: s.seat,
      desk: s.desk,
      code: seatCode(s.row, s.seat),
      studentId: s.who!.id,
      studentName: s.who!.name,
      classSectionId: s.who!.cls.id,
      classLabel: s.who!.cls.label,
      roll: s.who!.roll,
    }))
    .sort((a, b) => a.row - b.row || a.seat - b.seat);

  const plan = gradePlan(withStudents, room);
  const soloRoom = withStudents.length === 1;
  const soloCol = loneSection(withStudents, plan);
  const unseated = total - best!.seated;

  const notes: string[] = [];
  notes.push(
    unseated > 0
      ? `${best!.seated} of ${total} students seated. ${unseated} need another room.`
      : `All ${total} students seated.`,
  );
  if (soloRoom) {
    notes.push(
      `Only ${withStudents[0].label} is in this room, so classmates must sit together. Roll numbers are spread out instead.`,
    );
  } else if (soloCol) {
    notes.push(
      `${soloCol} is the only section of its class here, so those students sit one behind another. Left and right is always a different paper.`,
    );
  } else if (best!.bent > 0) {
    notes.push(
      `${best!.bent} student${best!.bent === 1 ? '' : 's'} could not follow the column rule — this room is ${room.cols} desks wide; try one more or one less.`,
    );
  }
  if (best!.clashes === 0) notes.push('No rule was broken. Ready to print.');

  return {
    seats,
    report: {
      capacity,
      seated: best!.seated,
      unseated,
      clashes: best!.clashes,
      bent: best!.bent,
      notes,
    },
    seed: bestSeed,
  };
}
