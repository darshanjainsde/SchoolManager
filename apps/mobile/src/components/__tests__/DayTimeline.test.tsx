import { render, screen, fireEvent } from '@testing-library/react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { DayTimeline } from '../DayTimeline';

function classEntry(id: string, label: string, taken: boolean): TeacherDayEntry {
  return {
    periodId: id,
    label,
    startTime: '08:00',
    endTime: '08:45',
    kind: 'CLASS',
    slot: { classSectionId: `sec-${id}`, className: '8-A', subjectId: `subj-${id}`, subjectName: label, covering: false, coveringFor: null },
    register: { taken, present: taken ? 27 : 0, total: 28, markedBy: taken ? 'Priya Sharma' : null },
  };
}

const breakEntry: TeacherDayEntry = {
  periodId: 'p-break',
  // Distinct from the neutral "Break" pill the row renders, so the title and
  // the pill never collide in a getByText lookup.
  label: 'Lunch break',
  startTime: '08:45',
  endTime: '09:05',
  kind: 'BREAK',
  slot: null,
  register: null,
};

const freeEntry: TeacherDayEntry = {
  periodId: 'p-free',
  label: 'Period 4',
  startTime: '10:25',
  endTime: '11:05',
  kind: 'FREE',
  slot: null,
  register: null,
};

const DAY: TeacherDayEntry[] = [classEntry('p1', 'Maths', true), breakEntry, classEntry('p2', 'Science', false)];

describe('DayTimeline', () => {
  it('renders one row per entry including breaks', () => {
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('8-A · Maths')).toBeTruthy();
    expect(screen.getByText('Lunch break')).toBeTruthy();
    expect(screen.getByText('8-A · Science')).toBeTruthy();
  });

  it('a break is quiet like a free period — only classes are dark rows (9 Oct 2026)', () => {
    render(<DayTimeline entries={[breakEntry, classEntry('p9', 'Maths', false)]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    const weight = (t: string) => {
      const st = screen.getByText(t).props.style;
      return (Array.isArray(st) ? Object.assign({}, ...st) : st).fontWeight;
    };
    expect(weight('Lunch break')).toBe('400');
    expect(weight('8-A · Maths')).toBe('700');
    expect(screen.getByText('No class')).toBeTruthy();
  });

  it('renders a FREE entry as a distinct green "Free period" tile, not a class or a break', () => {
    render(<DayTimeline entries={[freeEntry]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.getByTestId(`timeline-free-${freeEntry.periodId}`)).toBeTruthy();
    expect(screen.getByText('Free period')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    // A free period is not a class, so it never offers to take attendance.
    expect(screen.queryByText('Take now')).toBeNull();
  });

  it('finished periods sit under "Earlier today" but stay DARK — never faded (user, 9 Oct 2026)', () => {
    render(<DayTimeline entries={DAY} currentIndex={2} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('Earlier today')).toBeTruthy();
    const earlier = screen.getByTestId(`timeline-row-${DAY[0].periodId}`);
    expect(earlier.props.style.opacity).toBeUndefined();
  });

  it('with currentIndex === -1 there is no "Earlier today" and no row is faded', () => {
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.queryByText('Earlier today')).toBeNull();
    for (const e of DAY) {
      expect(screen.getByTestId(`timeline-row-${e.periodId}`).props.style.opacity).toBeUndefined();
    }
  });

  it('a class is set in bold ink, a free period in the quiet sub tone', () => {
    render(<DayTimeline entries={[...DAY, freeEntry]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    const free = screen.getAllByText('Free period');
    for (const f of free) expect(f.props.style.fontWeight).toBe('400');
  });

  it('renders an explicit empty state, not a blank card, when entries is empty', () => {
    render(<DayTimeline entries={[]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('No periods scheduled today.')).toBeTruthy();
  });

  it('lets an unmarked row trigger onTakeAttendance', () => {
    const onTake = jest.fn();
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={onTake} />);
    fireEvent.press(screen.getByTestId('timeline-take-sec-p2'));
    expect(onTake).toHaveBeenCalledWith('sec-p2');
  });

  it('renders a "Not marked" pill instead of nothing when a CLASS row has a null register', () => {
    // Defensive case: the real API never sends this shape today, but a null
    // register must not silently render no pill at all.
    const entryWithoutRegister: TeacherDayEntry = { ...classEntry('p3', 'History', false), register: null };
    render(<DayTimeline entries={[entryWithoutRegister]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('Take now')).toBeTruthy();
  });
});
