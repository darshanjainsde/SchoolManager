import {
  DEFAULT_RULES,
  generateSeating,
  roomCapacity,
  seatCode,
  type SeatingClass,
  type SeatingRoom,
  type SeatingRules,
} from './seating-engine';

// A school shaped like the one in the pitch: two grades, two sections each.
function makeClass(id: string, label: string, grade: number, count: number): SeatingClass {
  return {
    id,
    label,
    grade,
    students: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i + 1}`,
      name: `${label} Student ${i + 1}`,
      roll: i + 1,
    })),
  };
}

const CLASSES: SeatingClass[] = [
  makeClass('s9a', '9-A', 9, 13),
  makeClass('s9b', '9-B', 9, 12),
  makeClass('s10a', '10-A', 10, 10),
  makeClass('s10b', '10-B', 10, 10),
];

function room(rows: number, cols: number, seatsPerDesk = 1, removedDesks: string[] = []): SeatingRoom {
  return { rows, cols, seatsPerDesk, removedDesks };
}

/** Re-derives clashes from the finished chart, independently of the engine. */
function auditAdjacency(
  seats: { row: number; seat: number; classSectionId: string; roll: number | null }[],
) {
  const at = new Map(seats.map((s) => [`${s.row}:${s.seat}`, s]));
  let sameClass = 0;
  let nearRoll = 0;
  for (const s of seats) {
    for (const [dr, ds] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const nb = at.get(`${s.row + dr}:${s.seat + ds}`);
      if (!nb) continue;
      if (nb.classSectionId === s.classSectionId) {
        sameClass++;
        if (nb.roll !== null && s.roll !== null && Math.abs(nb.roll - s.roll) <= 1) nearRoll++;
      }
    }
  }
  return { sameClass, nearRoll };
}

describe('seatCode', () => {
  it('reads the way a desk sticker does, 1-based with a padded seat', () => {
    expect(seatCode(0, 0)).toBe('R1·S01');
    expect(seatCode(2, 6)).toBe('R3·S07');
    expect(seatCode(5, 11)).toBe('R6·S12');
  });
});

describe('roomCapacity', () => {
  it('keeps the back row spare when that rule is on', () => {
    expect(roomCapacity(room(6, 9), DEFAULT_RULES)).toBe(45);
    expect(roomCapacity(room(6, 9), { ...DEFAULT_RULES, backRowFree: false })).toBe(54);
  });

  it('counts both seats of a shared desk', () => {
    expect(roomCapacity(room(6, 9, 2), DEFAULT_RULES)).toBe(90);
  });

  it('drops removed desks, and drops them from usable rows only', () => {
    // Row 2 emptied: 9 desks gone from a usable row.
    expect(roomCapacity(room(6, 9, 1, ['2:0', '2:1', '2:2']), DEFAULT_RULES)).toBe(42);
    // A desk removed in the spare back row was never counted anyway.
    expect(roomCapacity(room(6, 9, 1, ['5:0']), DEFAULT_RULES)).toBe(45);
  });

  it('never reports a negative or NaN capacity for a one-row room', () => {
    expect(roomCapacity(room(1, 9), DEFAULT_RULES)).toBe(9);
  });
});

describe('generateSeating', () => {
  it('seats everyone with no rule broken in the default room', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    expect(out.report.seated).toBe(45);
    expect(out.report.unseated).toBe(0);
    expect(out.report.clashes).toBe(0);
    expect(out.seats).toHaveLength(45);
  });

  it('really does keep classmates apart — audited from the chart, not the counter', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    expect(auditAdjacency(out.seats).sameClass).toBe(0);
  });

  it('puts a different grade in every neighbouring column', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    const gradeOf = new Map(CLASSES.map((c) => [c.id, c.grade]));
    const byColumn = new Map<number, Set<number>>();
    for (const s of out.seats) {
      const set = byColumn.get(s.seat) ?? new Set<number>();
      set.add(gradeOf.get(s.classSectionId)!);
      byColumn.set(s.seat, set);
    }
    for (const grades of byColumn.values()) expect(grades.size).toBe(1);
    const cols = [...byColumn.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < cols.length; i++) {
      expect([...cols[i][1]][0]).not.toBe([...cols[i - 1][1]][0]);
    }
  });

  it('leaves the back row empty', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    expect(out.seats.some((s) => s.row === 5)).toBe(false);
  });

  it('uses the back row when the rule is off', () => {
    const out = generateSeating(CLASSES, room(6, 9), { ...DEFAULT_RULES, backRowFree: false });
    expect(out.report.capacity).toBe(54);
    expect(out.report.seated).toBe(45);
  });

  it('is deterministic — the same seed rebuilds the same hall', () => {
    const a = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES, 77);
    const b = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES, 77);
    expect(b.seats).toEqual(a.seats);
    expect(b.seed).toBe(a.seed);
  });

  it('gives a different hall for a different seed, which is what Reshuffle needs', () => {
    const a = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES, 77);
    const b = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES, 512);
    expect(b.seats).not.toEqual(a.seats);
  });

  it('never seats a student twice', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    expect(new Set(out.seats.map((s) => s.studentId)).size).toBe(out.seats.length);
  });

  it('never puts two students in one seat', () => {
    const out = generateSeating(CLASSES, room(6, 9), DEFAULT_RULES);
    expect(new Set(out.seats.map((s) => `${s.row}:${s.seat}`)).size).toBe(out.seats.length);
  });

  it('never places anyone on a removed desk', () => {
    const removed = ['2:0', '2:1', '2:2', '0:8'];
    const out = generateSeating(CLASSES, room(6, 9, 1, removed), DEFAULT_RULES);
    for (const s of out.seats) expect(removed).not.toContain(`${s.row}:${s.desk}`);
  });

  it('reports the overflow instead of squeezing people in', () => {
    const out = generateSeating(CLASSES, room(6, 8), DEFAULT_RULES);
    expect(out.report.capacity).toBe(40);
    expect(out.report.seated).toBe(40);
    expect(out.report.unseated).toBe(5);
    expect(out.report.notes.join(' ')).toContain('need another room');
  });

  it('leaves spare desks empty rather than bending a rule to fill a big room', () => {
    const out = generateSeating(CLASSES, room(10, 12), DEFAULT_RULES);
    expect(out.report.seated).toBe(45);
    expect(out.report.clashes).toBe(0);
    expect(out.report.bent).toBe(0);
  });

  it('handles two students to a desk without seating classmates together', () => {
    const out = generateSeating(CLASSES, room(6, 9, 2), DEFAULT_RULES);
    expect(out.report.seated).toBe(45);
    expect(out.report.clashes).toBe(0);
    expect(auditAdjacency(out.seats).sameClass).toBe(0);
  });

  describe('when the rules cannot all hold', () => {
    it('explains a single-class room instead of emitting clashes', () => {
      const out = generateSeating([CLASSES[0]], room(6, 9), DEFAULT_RULES);
      expect(out.report.seated).toBe(13);
      expect(out.report.clashes).toBe(0);
      expect(out.report.notes.join(' ')).toContain('classmates must sit together');
    });

    it('still spreads roll numbers when one class fills a room on its own', () => {
      const out = generateSeating([CLASSES[0]], room(6, 9), DEFAULT_RULES);
      expect(auditAdjacency(out.seats).nearRoll).toBe(0);
    });

    it('explains one section per grade, and keeps side-by-side a different paper', () => {
      const out = generateSeating([CLASSES[0], CLASSES[2]], room(6, 9), DEFAULT_RULES);
      expect(out.report.clashes).toBe(0);
      expect(out.report.notes.join(' ')).toContain('one behind another');

      // Front/back may be a classmate; left/right may never be.
      const at = new Map(out.seats.map((s) => [`${s.row}:${s.seat}`, s]));
      for (const s of out.seats) {
        const right = at.get(`${s.row}:${s.seat + 1}`);
        if (right) expect(right.classSectionId).not.toBe(s.classSectionId);
      }
    });
  });

  describe('edge shapes', () => {
    const shapes: [string, SeatingRoom][] = [
      ['one row', room(1, 9)],
      ['one column', room(6, 1)],
      ['a cupboard', room(3, 4)],
      ['a hall', room(12, 14, 2)],
      ['seven wide', room(6, 7)],
      ['a row of desks missing', room(6, 9, 1, ['2:0', '2:1', '2:2', '2:3', '2:4', '2:5', '2:6', '2:7', '2:8'])],
    ];

    it.each(shapes)('breaks no rule in %s', (_name, r) => {
      const out = generateSeating(CLASSES, r, DEFAULT_RULES);
      expect(out.report.clashes).toBe(0);
      expect(out.report.seated).toBe(Math.min(roomCapacity(r, DEFAULT_RULES), 45));
      expect(auditAdjacency(out.seats).sameClass).toBe(0);
    });
  });

  describe('degenerate input', () => {
    it('says so when no class is ticked', () => {
      const out = generateSeating([], room(6, 9), DEFAULT_RULES);
      expect(out.seats).toEqual([]);
      expect(out.report.notes[0]).toContain('No classes are ticked');
    });

    it('says so when every desk has been removed', () => {
      const removed: string[] = [];
      for (let r = 0; r < 6; r++) for (let d = 0; d < 9; d++) removed.push(`${r}:${d}`);
      const out = generateSeating(CLASSES, room(6, 9, 1, removed), DEFAULT_RULES);
      expect(out.report.capacity).toBe(0);
      expect(out.report.notes[0]).toContain('no usable desks');
    });

    it('ignores a class with nobody in it', () => {
      const empty: SeatingClass = { id: 'x', label: '11-A', grade: 11, students: [] };
      const out = generateSeating([...CLASSES, empty], room(6, 9), DEFAULT_RULES);
      expect(out.report.seated).toBe(45);
    });

    it('does not choke on students with no roll number recorded', () => {
      const noRolls: SeatingClass[] = CLASSES.map((c) => ({
        ...c,
        students: c.students.map((s) => ({ ...s, roll: null })),
      }));
      const out = generateSeating(noRolls, room(6, 9), DEFAULT_RULES);
      expect(out.report.seated).toBe(45);
      expect(out.report.clashes).toBe(0);
    });
  });

  describe('with every rule switched off', () => {
    const none: SeatingRules = {
      noClassmates: false,
      alternateCols: false,
      spreadRolls: false,
      backRowFree: false,
    };

    it('still seats everyone and reports no clash, because nothing is being asked', () => {
      const out = generateSeating(CLASSES, room(6, 9), none);
      expect(out.report.seated).toBe(45);
      expect(out.report.clashes).toBe(0);
      expect(out.report.capacity).toBe(54);
    });
  });
});
