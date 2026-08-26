import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PlannedSeat, SeatingRules } from '@skoolos/types';
import {
  RoomGrid,
  capacityOf,
  clashesIn,
  deskCount,
  describeNeighbours,
  seatCode,
  toneFor,
  usableRows,
  type RoomShape,
} from './room-grid';

const RULES: SeatingRules = {
  noClassmates: true,
  alternateCols: true,
  spreadRolls: true,
  backRowFree: true,
};

function room(rows: number, cols: number, seatsPerDesk = 1, removedDesks: string[] = []): RoomShape {
  return { rows, cols, seatsPerDesk, removedDesks };
}

function seat(row: number, s: number, cls: string, roll: number | null, name = 'A Student'): PlannedSeat {
  return {
    row,
    seat: s,
    desk: s,
    code: seatCode(row, s),
    studentId: `${cls}-${roll}`,
    studentName: name,
    classSectionId: cls,
    classLabel: cls === 'a' ? '9-A' : '9-B',
    roll,
  };
}

describe('seatCode', () => {
  it('matches what the desk sticker says — 1-based, seat padded', () => {
    expect(seatCode(0, 0)).toBe('R1·S01');
    expect(seatCode(2, 6)).toBe('R3·S07');
  });
});

describe('capacity as the office types', () => {
  it('keeps the back row spare while that rule is on', () => {
    expect(capacityOf(room(6, 9), true)).toBe(45);
    expect(capacityOf(room(6, 9), false)).toBe(54);
  });

  it('counts both halves of a shared bench', () => {
    expect(capacityOf(room(6, 9, 2), true)).toBe(90);
  });

  it('drops removed desks', () => {
    expect(capacityOf(room(6, 9, 1, ['0:0', '0:1']), true)).toBe(43);
  });

  it('never leaves a one-row room with no usable row', () => {
    expect(usableRows(room(1, 9), true)).toBe(1);
    expect(capacityOf(room(1, 9), true)).toBe(9);
  });

  it('counts desks separately from seats, because the hint says both', () => {
    expect(deskCount(room(6, 9, 2, ['0:0']))).toBe(53);
    expect(capacityOf(room(6, 9, 2, ['0:0']), true)).toBe(88);
  });
});

describe('drawing the room', () => {
  it('draws a desk for every position, and a seat for every place at it', () => {
    render(<RoomGrid room={room(3, 4, 2)} backRowFree onToggleDesk={vi.fn()} />);
    // 3 rows x 4 desks x 2 seats
    expect(screen.getAllByRole('button')).toHaveLength(24);
    expect(screen.getByTestId('cell-0:0')).toBeInTheDocument();
    expect(screen.getByTestId('cell-2:7')).toBeInTheDocument();
  });

  it('marks the back row spare rather than hiding it', () => {
    render(<RoomGrid room={room(3, 2)} backRowFree onToggleDesk={vi.fn()} />);
    expect(screen.getByTestId('cell-2:0')).toHaveAttribute('data-state', 'spare');
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('data-state', 'empty');
  });

  it('shows a removed desk as gone, in the spare row too', () => {
    render(<RoomGrid room={room(3, 2, 1, ['0:1', '2:0'])} backRowFree onToggleDesk={vi.fn()} />);
    expect(screen.getByTestId('cell-0:1')).toHaveAttribute('data-state', 'gone');
    expect(screen.getByTestId('cell-2:0')).toHaveAttribute('data-state', 'gone');
  });

  it('reports the DESK, not the seat, when a bench is clicked — both halves go together', () => {
    const onToggleDesk = vi.fn();
    render(<RoomGrid room={room(2, 3, 2)} backRowFree onToggleDesk={onToggleDesk} />);
    // seat 3 is the first half of desk 1
    fireEvent.click(screen.getByTestId('cell-0:3'));
    expect(onToggleDesk).toHaveBeenCalledWith(0, 1);
  });

  it('is reachable from the keyboard', () => {
    const onToggleDesk = vi.fn();
    render(<RoomGrid room={room(2, 2)} backRowFree onToggleDesk={onToggleDesk} />);
    fireEvent.keyDown(screen.getByTestId('cell-0:1'), { key: 'Enter' });
    expect(onToggleDesk).toHaveBeenCalledWith(0, 1);
  });
});

describe('keyboard navigation', () => {
  // 54 desks in a normal hall and 1,200 in the biggest room the API accepts.
  // If each is its own tab stop, reaching the button under the grid means
  // pressing Tab twelve hundred times.
  it('is a single tab stop, not one per desk', () => {
    render(<RoomGrid room={room(6, 9)} backRowFree onToggleDesk={vi.fn()} />);
    const tabbable = screen
      .getAllByRole('button')
      .filter((el) => el.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(screen.getByTestId('cell-0:0'));
  });

  it('moves the cursor with the arrow keys', () => {
    render(<RoomGrid room={room(4, 4)} backRowFree onToggleDesk={vi.fn()} />);
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(screen.getByTestId('cell-0:1')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByTestId('cell-1:1')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('tabindex', '0');
  });

  it('stops at the edges instead of wrapping into the wrong row', () => {
    render(<RoomGrid room={room(3, 3)} backRowFree onToggleDesk={vi.fn()} />);
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('tabindex', '0');
    for (let i = 0; i < 6; i++) fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(screen.getByTestId('cell-0:2')).toHaveAttribute('tabindex', '0');
  });

  it('Home and End jump across the row', () => {
    render(<RoomGrid room={room(2, 5)} backRowFree onToggleDesk={vi.fn()} />);
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(screen.getByTestId('cell-0:4')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('tabindex', '0');
  });

  it('counts both halves of a bench as separate seats when moving', () => {
    render(<RoomGrid room={room(2, 3, 2)} backRowFree onToggleDesk={vi.fn()} />);
    const grid = screen.getByRole('grid');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(screen.getByTestId('cell-0:5')).toHaveAttribute('tabindex', '0');
  });

  it('names the grid so a screen reader says what the arrows do', () => {
    const { rerender } = render(<RoomGrid room={room(2, 2)} backRowFree onToggleDesk={vi.fn()} />);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toMatch(/takes a desk out/);
    rerender(<RoomGrid room={room(2, 2)} backRowFree seats={[]} classOrder={[]} />);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toMatch(/explains a seat/);
  });
});

describe('the seated room', () => {
  const seats = [seat(0, 0, 'a', 1, 'Aarav Sharma'), seat(0, 1, 'b', 5, 'Diya Meena')];

  it('names the child, the class and the seat for a screen reader', () => {
    render(<RoomGrid room={room(2, 2)} backRowFree seats={seats} classOrder={['a', 'b']} />);
    expect(screen.getByRole('button', { name: 'Aarav Sharma, 9-A, roll 1, R1·S01' })).toBeInTheDocument();
  });

  it('gives each class its own tone', () => {
    render(<RoomGrid room={room(2, 2)} backRowFree seats={seats} classOrder={['a', 'b']} />);
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('data-tone', 'c1');
    expect(screen.getByTestId('cell-0:1')).toHaveAttribute('data-tone', 'c2');
  });

  it('leaves an empty desk unclickable, so only a child answers "why"', () => {
    const onPickSeat = vi.fn();
    render(
      <RoomGrid room={room(2, 2)} backRowFree seats={seats} classOrder={['a', 'b']} onPickSeat={onPickSeat} />,
    );
    fireEvent.click(screen.getByTestId('cell-1:0'));
    expect(onPickSeat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cell-0:0'));
    expect(onPickSeat).toHaveBeenCalledWith('0:0');
  });

  it('does not offer the seat-code hint once children are in the room', () => {
    // Row 1 of three, so it is a USABLE empty desk — in a two-row room row 1 is
    // the spare back row and would correctly read "spare" instead.
    render(<RoomGrid room={room(3, 2)} backRowFree seats={seats} classOrder={['a', 'b']} />);
    expect(screen.getByTestId('cell-1:1')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByTestId('cell-1:1').textContent).toBe('');
    expect(screen.getByTestId('cell-2:1')).toHaveAttribute('data-state', 'spare');
  });
});

describe('showing where a rule broke', () => {
  it('marks both seats of a classmate pair', () => {
    const seats = [seat(0, 0, 'a', 1), seat(0, 1, 'a', 9)];
    const bad = clashesIn(seats, RULES, 2);
    expect(bad.has('0:0')).toBe(true);
    expect(bad.has('0:1')).toBe(true);
  });

  it('marks neighbouring roll numbers in the same class', () => {
    const seats = [seat(0, 0, 'a', 4), seat(1, 0, 'a', 5)];
    expect(clashesIn(seats, { ...RULES, noClassmates: false }, 2).has('0:0')).toBe(true);
  });

  it('leaves near rolls in DIFFERENT classes alone — they are unrelated children', () => {
    const seats = [seat(0, 0, 'a', 4), seat(0, 1, 'b', 5)];
    expect(clashesIn(seats, RULES, 2).size).toBe(0);
  });

  it('stays quiet when one class fills the room, because the engine already explained it', () => {
    const seats = [seat(0, 0, 'a', 1), seat(0, 1, 'a', 9)];
    expect(clashesIn(seats, RULES, 1).size).toBe(0);
  });

  it('says nothing when the rule is off', () => {
    const seats = [seat(0, 0, 'a', 1), seat(0, 1, 'a', 9)];
    expect(clashesIn(seats, { ...RULES, noClassmates: false, spreadRolls: false }, 2).size).toBe(0);
  });

  it('puts the mark on the floor, not just in the count', () => {
    const seats = [seat(0, 0, 'a', 1), seat(0, 1, 'a', 9)];
    render(
      <RoomGrid
        room={room(2, 2)}
        backRowFree
        seats={seats}
        classOrder={['a']}
        clashes={clashesIn(seats, RULES, 2)}
      />,
    );
    expect(screen.getByTestId('cell-0:0')).toHaveAttribute('data-clash', 'true');
    expect(screen.getByTestId('cell-1:0')).not.toHaveAttribute('data-clash');
  });
});

describe('why is this child here', () => {
  it('names every occupied neighbour and which side it is on', () => {
    const seats = [
      seat(1, 1, 'a', 3, 'Aarav Sharma'),
      seat(1, 0, 'b', 7),
      seat(0, 1, 'b', 2),
    ];
    const text = describeNeighbours(seats[0], seats);
    expect(text).toContain('Around Aarav');
    expect(text).toContain('9-B on the left');
    expect(text).toContain('9-B in front');
    expect(text).not.toContain('on the right');
  });

  it('calls out a classmate rather than quietly listing them', () => {
    const seats = [seat(0, 0, 'a', 3, 'Aarav Sharma'), seat(0, 1, 'a', 9)];
    expect(describeNeighbours(seats[0], seats)).toContain('same class');
  });

  it('says so plainly when a child sits alone', () => {
    const only = [seat(0, 0, 'a', 3, 'Aarav Sharma')];
    expect(describeNeighbours(only[0], only)).toBe('No one is seated next to this desk.');
  });
});

describe('class tones', () => {
  it('cycles past four classes rather than running out', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(toneFor(order, 'a')).toBe('c1');
    expect(toneFor(order, 'd')).toBe('c4');
    expect(toneFor(order, 'e')).toBe('c1');
  });
});
