import { render, screen, fireEvent } from '@testing-library/react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { NowCard } from '../NowCard';

function classEntry(overrides: Partial<TeacherDayEntry> = {}): TeacherDayEntry {
  return {
    periodId: 'p-2',
    label: 'P2',
    startTime: '09:05',
    endTime: '09:50',
    kind: 'CLASS',
    slot: {
      classSectionId: 'sec-8a',
      className: '8-A',
      subjectId: 'subj-maths',
      subjectName: 'Mathematics',
      covering: false,
      coveringFor: null,
    },
    register: { taken: false, present: 0, total: 28, markedBy: null },
    ...overrides,
  };
}

const breakEntry: TeacherDayEntry = {
  periodId: 'p-break',
  label: 'Break',
  startTime: '08:45',
  endTime: '09:05',
  kind: 'BREAK',
  slot: null,
  register: null,
};

const nextClass: TeacherDayEntry = classEntry({
  periodId: 'p-3',
  label: 'P3',
  startTime: '09:50',
  endTime: '10:35',
  slot: {
    classSectionId: 'sec-8b',
    className: '8-B',
    subjectId: 'subj-science',
    subjectName: 'Science',
    covering: false,
    coveringFor: null,
  },
});

describe('NowCard', () => {
  it('renders the class name, subject and progress for a current CLASS period', () => {
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('8-A · Mathematics')).toBeTruthy();
    const bar = screen.getByTestId('now-progress');
    expect(bar.props.accessibilityValue.now).toBe(44);
  });

  it('shows a Take attendance button when register.taken === false', () => {
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('Take attendance')).toBeTruthy();
  });

  it('calls onTakeAttendance with the classSectionId when pressed', () => {
    const onTake = jest.fn();
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={onTake} />);
    fireEvent.press(screen.getByTestId('now-take-sec-8a'));
    expect(onTake).toHaveBeenCalledWith('sec-8a');
  });

  it('shows the present count and marker name when register.taken === true, and hides Take attendance', () => {
    render(
      <NowCard
        entry={classEntry({ register: { taken: true, present: 27, total: 28, markedBy: 'Priya Sharma' } })}
        elapsed={20}
        total={45}
        nextEntry={null}
        onTakeAttendance={jest.fn()}
      />,
    );
    expect(screen.getByText('✓ 27/28 present')).toBeTruthy();
    expect(screen.getByText('Marked by Priya Sharma')).toBeTruthy();
    expect(screen.queryByText('Take attendance')).toBeNull();
  });

  it('shows Covering for Ravi Kumar when slot.covering is true', () => {
    render(
      <NowCard
        entry={classEntry({
          slot: {
            classSectionId: 'sec-8a',
            className: '8-A',
            subjectId: 'subj-maths',
            subjectName: 'Mathematics',
            covering: true,
            coveringFor: 'Ravi Kumar',
          },
        })}
        elapsed={20}
        total={45}
        nextEntry={null}
        onTakeAttendance={jest.fn()}
      />,
    );
    expect(screen.getByText('Covering for Ravi Kumar')).toBeTruthy();
  });

  it('during a BREAK names the next class rather than showing a Take action', () => {
    render(<NowCard entry={breakEntry} elapsed={5} total={20} nextEntry={nextClass} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText('Break')).toBeTruthy();
    expect(screen.getByText(/8-B · Science/)).toBeTruthy();
    expect(screen.queryByText('Take attendance')).toBeNull();
  });

  it('with entry === null and a nextEntry names the next class rather than claiming the day is over', () => {
    render(<NowCard entry={null} elapsed={0} total={0} nextEntry={nextClass} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText(/8-B · Science/)).toBeTruthy();
    expect(screen.queryByText("That's it for today")).toBeNull();
  });

  it('with entry === null and nextEntry === null says the day is finished', () => {
    render(<NowCard entry={null} elapsed={0} total={0} nextEntry={null} onTakeAttendance={jest.fn()} />);
    expect(screen.getByText("That's it for today")).toBeTruthy();
  });

  it('with total === 0 does not render NaN% or crash', () => {
    render(<NowCard entry={classEntry()} elapsed={0} total={0} nextEntry={null} onTakeAttendance={jest.fn()} />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByTestId('now-progress').props.accessibilityValue.now).toBe(0);
  });
});
