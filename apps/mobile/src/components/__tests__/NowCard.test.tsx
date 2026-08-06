import { render, screen, fireEvent, within } from '@testing-library/react-native';
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
    expect(screen.getByText('Take attendance →')).toBeTruthy();
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

  it('with entry === null and nextEntry === null renders the day-complete wrap-up with its summary', () => {
    render(
      <NowCard
        entry={null}
        elapsed={0}
        total={0}
        nextEntry={null}
        onTakeAttendance={jest.fn()}
        summary={{ classesTaught: 5, studentsMarked: 148 }}
      />,
    );
    expect(screen.getByText('Day complete')).toBeTruthy();
    expect(screen.getByText('5 classes taught')).toBeTruthy();
    // Summary cells: classes taught + students marked (a notes count isn't
    // available from TeacherDay, so that cell is omitted rather than faked).
    const summary = screen.getByTestId('now-summary');
    expect(within(summary).getByText('5')).toBeTruthy();
    expect(within(summary).getByText('classes taught')).toBeTruthy();
    expect(within(summary).getByText('148')).toBeTruthy();
    expect(within(summary).getByText('students marked')).toBeTruthy();
  });

  it('during a FREE period renders the green free-period hero counting down the remaining minutes', () => {
    const freeEntry: TeacherDayEntry = {
      periodId: 'p-free',
      label: 'Period 4',
      startTime: '10:25',
      endTime: '11:05',
      kind: 'FREE',
      slot: null,
      register: null,
    };
    render(
      <NowCard entry={freeEntry} elapsed={0} total={40} nextEntry={nextClass} onTakeAttendance={jest.fn()} />,
    );
    expect(screen.getByText('Period 4 · Free period')).toBeTruthy();
    expect(screen.getByText("You're free — 40 min")).toBeTruthy();
    // Names the next class, and offers no attendance action.
    expect(screen.getByText(/Next: 8-B · Science at 09:50/)).toBeTruthy();
    expect(screen.queryByText('Take attendance →')).toBeNull();
    expect(screen.getByTestId('now-card')).toBeTruthy();
  });

  it('with total === 0 does not render NaN% or crash', () => {
    render(<NowCard entry={classEntry()} elapsed={0} total={0} nextEntry={null} onTakeAttendance={jest.fn()} />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByTestId('now-progress').props.accessibilityValue.now).toBe(0);
  });

  describe('opening the class', () => {
    // The register deliberately drops the names so it can be marked at walking
    // pace. This is the way to the screen that has them.
    it('offers no way in when no handler was given, rather than a dead tap', () => {
      render(
        <NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={jest.fn()} />,
      );
      expect(screen.queryByTestId('now-card-press')).toBeNull();
      expect(screen.queryByTestId('now-open-sec-8a')).toBeNull();
    });

    it('makes the WHOLE hero the target — the biggest thing on Home, reached mid-corridor', () => {
      const open = jest.fn();
      render(
        <NowCard
          entry={classEntry()}
          elapsed={20}
          total={45}
          nextEntry={null}
          onTakeAttendance={jest.fn()}
          onOpenClass={open}
        />,
      );
      fireEvent.press(screen.getByTestId('now-card-press'));
      expect(open).toHaveBeenCalledWith('sec-8a');
    });

    it('also gives the foot of the card its own named button', () => {
      // Not decoration on a tappable card: a screen reader needs something it
      // can land on and activate, and "See who's in the room" is not that
      // unless it is a real button.
      const open = jest.fn();
      render(
        <NowCard
          entry={classEntry()}
          elapsed={20}
          total={45}
          nextEntry={null}
          onTakeAttendance={jest.fn()}
          onOpenClass={open}
        />,
      );
      const row = screen.getByTestId('now-open-sec-8a');
      expect(row.props.accessibilityLabel).toBe('Open 8-A, see who is in the room');
      fireEvent.press(row);
      expect(open).toHaveBeenCalledWith('sec-8a');
    });

    it('does not swallow the Take attendance button into one accessibility element', () => {
      // Pressable defaults to accessible:true, which on iOS collapses
      // everything inside it into a single VoiceOver element. If the wrapper
      // ever stops opting out, the one action this card asks for disappears
      // for the people who most need it labelled.
      const open = jest.fn();
      const take = jest.fn();
      render(
        <NowCard
          entry={classEntry()}
          elapsed={20}
          total={45}
          nextEntry={null}
          onTakeAttendance={take}
          onOpenClass={open}
        />,
      );
      expect(screen.getByTestId('now-card-press').props.accessible).toBe(false);
      fireEvent.press(screen.getByTestId('now-take-sec-8a'));
      expect(take).toHaveBeenCalledWith('sec-8a');
      expect(open).not.toHaveBeenCalled();
    });

    it('stays untappable on a FREE period — there is no class to open', () => {
      const free = classEntry({ kind: 'FREE', slot: null, register: null, label: 'P4' });
      render(
        <NowCard
          entry={free}
          elapsed={10}
          total={45}
          nextEntry={nextClass}
          onTakeAttendance={jest.fn()}
          onOpenClass={jest.fn()}
        />,
      );
      expect(screen.queryByTestId('now-card-press')).toBeNull();
    });
  });
});
