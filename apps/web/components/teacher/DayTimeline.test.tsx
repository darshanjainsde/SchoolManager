import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TeacherDayEntry } from '@skoolos/types';
import { DayTimeline } from './DayTimeline';

function classEntry(id: string, label: string, taken: boolean): TeacherDayEntry {
  return {
    periodId: id,
    label,
    startTime: '08:00',
    endTime: '08:45',
    kind: 'CLASS',
    slot: { classSectionId: `sec-${id}`, className: '8-A', subjectName: label, covering: false, coveringFor: null },
    register: { taken, present: taken ? 27 : 0, total: 28, markedBy: taken ? 'Priya Sharma' : null },
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

const DAY: TeacherDayEntry[] = [classEntry('p1', 'Maths', true), breakEntry, classEntry('p2', 'Science', false)];

describe('DayTimeline', () => {
  it('renders one row per entry including breaks', () => {
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText('8-A · Maths')).toBeInTheDocument();
    expect(screen.getByText('Break')).toBeInTheDocument();
    expect(screen.getByText('8-A · Science')).toBeInTheDocument();
  });

  it('marks rows before currentIndex as dimmed/earlier', () => {
    const { container } = render(<DayTimeline entries={DAY} currentIndex={2} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText('Earlier today')).toBeInTheDocument();
    const dimmed = container.querySelectorAll('[data-dim="true"]');
    expect(dimmed).toHaveLength(2);
    const bright = container.querySelectorAll('[data-dim="false"]');
    expect(bright).toHaveLength(1);
  });

  it('with currentIndex === -1 renders every row as upcoming, none dimmed', () => {
    const { container } = render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={vi.fn()} />);
    expect(screen.queryByText('Earlier today')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-dim="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-dim="false"]')).toHaveLength(3);
  });

  it('renders an explicit empty state, not a blank card, when entries is empty', () => {
    render(<DayTimeline entries={[]} currentIndex={-1} onTakeAttendance={vi.fn()} />);
    expect(screen.getByText('No periods scheduled today.')).toBeInTheDocument();
  });

  it('lets an unmarked row trigger onTakeAttendance', () => {
    const onTake = vi.fn();
    render(<DayTimeline entries={DAY} currentIndex={-1} onTakeAttendance={onTake} />);
    screen.getByRole('button', { name: 'Not marked' }).click();
    expect(onTake).toHaveBeenCalledWith('sec-p2');
  });

  it('renders a "Not marked" pill instead of nothing when a CLASS row has a null register', () => {
    // Defensive case: the real API never sends this shape today, but a null
    // register must not silently render no pill at all.
    const entryWithoutRegister: TeacherDayEntry = { ...classEntry('p3', 'History', false), register: null };
    render(<DayTimeline entries={[entryWithoutRegister]} currentIndex={-1} onTakeAttendance={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Not marked' })).toBeInTheDocument();
  });
});
