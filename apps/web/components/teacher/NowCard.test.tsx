import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TeacherDayEntry } from '@skoolos/types';
import { NowCard } from './NowCard';

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
  slot: { classSectionId: 'sec-8b', className: '8-B', subjectName: 'Science', covering: false, coveringFor: null },
});

describe('NowCard', () => {
  it('renders the class name, subject and progress for a current CLASS period', () => {
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText('8-A · Mathematics')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '44');
  });

  it('shows Take attendance when register.taken === false', () => {
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Take attendance' })).toBeInTheDocument();
  });

  it('calls onTakeAttendance with the classSectionId when clicked', async () => {
    const onTake = vi.fn();
    render(<NowCard entry={classEntry()} elapsed={20} total={45} nextEntry={null} onTakeAttendance={onTake} />);
    screen.getByRole('button', { name: 'Take attendance' }).click();
    expect(onTake).toHaveBeenCalledWith('sec-8a');
  });

  it('shows the present count and marker name when register.taken === true, and does NOT show Take attendance', () => {
    render(
      <NowCard
        entry={classEntry({ register: { taken: true, present: 27, total: 28, markedBy: 'Priya Sharma' } })}
        elapsed={20}
        total={45}
        nextEntry={null}
        onTakeAttendance={vi.fn()}
      />,
    );
    expect(screen.getByText('✓ 27/28 present')).toBeInTheDocument();
    expect(screen.getByText('Marked by Priya Sharma')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take attendance' })).not.toBeInTheDocument();
  });

  it('shows Covering for Ravi Kumar when slot.covering is true', () => {
    render(
      <NowCard
        entry={classEntry({
          slot: {
            classSectionId: 'sec-8a',
            className: '8-A',
            subjectName: 'Mathematics',
            covering: true,
            coveringFor: 'Ravi Kumar',
          },
        })}
        elapsed={20}
        total={45}
        nextEntry={null}
        onTakeAttendance={vi.fn()}
      />,
    );
    expect(screen.getByText('Covering for Ravi Kumar')).toBeInTheDocument();
  });

  it('during a BREAK names the next class rather than showing a Take action', () => {
    render(<NowCard entry={breakEntry} elapsed={5} total={20} nextEntry={nextClass} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText('Break')).toBeInTheDocument();
    expect(screen.getByText(/8-B · Science/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take attendance' })).not.toBeInTheDocument();
  });

  it('with entry === null and a nextEntry names the next class rather than claiming the day is over', () => {
    render(<NowCard entry={null} elapsed={0} total={0} nextEntry={nextClass} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText(/8-B · Science/)).toBeInTheDocument();
    expect(screen.queryByText("That's it for today")).not.toBeInTheDocument();
  });

  it('with entry === null and nextEntry === null says the day is finished', () => {
    render(<NowCard entry={null} elapsed={0} total={0} nextEntry={null} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText("That's it for today")).toBeInTheDocument();
  });

  it('with total === 0 does not render NaN% or crash', () => {
    render(<NowCard entry={classEntry()} elapsed={0} total={0} nextEntry={null} onTakeAttendance={vi.fn()} />);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
