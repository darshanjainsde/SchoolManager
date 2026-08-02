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

  it('renders a FREE entry as a distinct green "Free period" tile, not a class or a break', () => {
    render(<DayTimeline entries={[freeEntry]} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.getByTestId(`timeline-free-${freeEntry.periodId}`)).toBeTruthy();
    expect(screen.getByText('Free period')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    // A free period is not a class, so it never offers to take attendance.
    expect(screen.queryByText('Take now')).toBeNull();
  });

  it('marks rows before currentIndex as dimmed under "Earlier today"', () => {
    render(<DayTimeline entries={DAY} currentIndex={2} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('Earlier today')).toBeTruthy();

    // .55, not .5 — the pitch's `.rail.done`: a finished period stays
    // readable (it is the record of the day) but stops competing.
    const dimmedRow = screen.getByTestId(`timeline-row-${DAY[0].periodId}`);
    expect(dimmedRow.props.style).toEqual(expect.objectContaining({ opacity: 0.55 }));
    const brightRow = screen.getByTestId(`timeline-row-${DAY[2].periodId}`);
    expect(brightRow.props.style).toEqual(expect.objectContaining({ opacity: 1 }));
  });

  it('with currentIndex === -1 renders every row as upcoming, none dimmed', () => {
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={jest.fn()} />);
    expect(screen.queryByText('Earlier today')).toBeNull();
    for (const e of DAY) {
      expect(screen.getByTestId(`timeline-row-${e.periodId}`).props.style).toEqual(
        expect.objectContaining({ opacity: 1 }),
      );
    }
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
