import { fireEvent, render, screen } from '@testing-library/react-native';
import { DaySelector } from '../DaySelector';

describe('DaySelector', () => {
  it('renders one chip per day present, in order, and omits days with no slots', () => {
    render(<DaySelector days={[1, 3, 5]} selectedDay={1} todayDayOfWeek={null} onSelect={jest.fn()} />);

    expect(screen.getByTestId('day-chip-1')).toBeTruthy();
    expect(screen.getByTestId('day-chip-3')).toBeTruthy();
    expect(screen.getByTestId('day-chip-5')).toBeTruthy();
    expect(screen.queryByTestId('day-chip-2')).toBeNull();
    expect(screen.queryByTestId('day-chip-6')).toBeNull();
    expect(screen.queryByTestId('day-chip-7')).toBeNull();
  });

  it('marks the selected chip via accessibilityState, and only that one', () => {
    render(<DaySelector days={[1, 2, 3]} selectedDay={2} todayDayOfWeek={null} onSelect={jest.fn()} />);

    expect(screen.getByTestId('day-chip-1').props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('day-chip-2').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('day-chip-3').props.accessibilityState).toEqual({ selected: false });
  });

  it("labels today's chip distinctly, independent of which chip is selected", () => {
    // Today (day 3) is not the selected day (day 1) — both signals must be
    // visible at once: day 1 shows "selected", day 3 shows "Today".
    render(<DaySelector days={[1, 2, 3]} selectedDay={1} todayDayOfWeek={3} onSelect={jest.fn()} />);

    expect(screen.getByTestId('day-chip-today-label-3')).toBeTruthy();
    expect(screen.queryByTestId('day-chip-today-label-1')).toBeNull();
    expect(screen.queryByTestId('day-chip-today-label-2')).toBeNull();
  });

  it('renders no "Today" label at all when today is not one of the days shown (e.g. a Sunday with no classes)', () => {
    render(<DaySelector days={[1, 2, 3, 4, 5]} selectedDay={1} todayDayOfWeek={null} onSelect={jest.fn()} />);

    for (const day of [1, 2, 3, 4, 5]) {
      expect(screen.queryByTestId(`day-chip-today-label-${day}`)).toBeNull();
    }
  });

  it('tapping a chip calls onSelect with that day', () => {
    const onSelect = jest.fn();
    render(<DaySelector days={[1, 2, 3]} selectedDay={1} todayDayOfWeek={null} onSelect={onSelect} />);

    fireEvent.press(screen.getByTestId('day-chip-3'));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});
