import { render } from '@testing-library/react-native';
import { StudentHero, type StudentHeroProps } from '../StudentHero';

function props(over: Partial<StudentHeroProps> = {}): StudentHeroProps {
  return {
    current: null,
    elapsed: 0,
    total: 0,
    next: null,
    todayStatus: null,
    hasSchoolToday: true,
    classesToday: 0,
    monthPercent: null,
    ...over,
  };
}

describe('StudentHero', () => {
  it('shows the "no school" state when there is no timetable today', () => {
    const { getByText } = render(<StudentHero {...props({ hasSchoolToday: false })} />);
    expect(getByText('Enjoy the day off')).toBeTruthy();
  });

  it('shows the live class, progress and today\'s status when a class is on now', () => {
    const { getByText, getByTestId } = render(
      <StudentHero
        {...props({
          current: {
            subjectName: 'Science',
            teacherName: 'Ms Iyer',
            periodLabel: 'Period 3',
            startTime: '09:55',
            endTime: '10:40',
          },
          elapsed: 20,
          total: 45,
          todayStatus: 'PRESENT',
        })}
      />,
    );
    expect(getByText('Science')).toBeTruthy();
    expect(getByText(/Ms Iyer · Period 3 · ends 10:40/)).toBeTruthy();
    expect(getByText('✓ Present today')).toBeTruthy();
    expect(getByTestId('shero-progress').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 44 });
  });

  it('names the next class before school / in a gap', () => {
    const { getByText } = render(
      <StudentHero {...props({ next: { subjectName: 'Mathematics', teacherName: 'Ms Sharma', startTime: '08:00' } })} />,
    );
    expect(getByText('Up next')).toBeTruthy();
    expect(getByText('Mathematics')).toBeTruthy();
    expect(getByText(/Ms Sharma · at 08:00/)).toBeTruthy();
  });

  it('wraps up the day with a summary when school is over', () => {
    const { getByText, getByTestId } = render(
      <StudentHero
        {...props({ current: null, next: null, classesToday: 6, todayStatus: 'PRESENT', monthPercent: 92 })}
      />,
    );
    expect(getByText("School's done for today")).toBeTruthy();
    expect(getByTestId('shero-summary')).toBeTruthy();
    expect(getByText('92%')).toBeTruthy();
  });

  it('shows no status chip when attendance is not yet marked', () => {
    const { queryByText } = render(
      <StudentHero {...props({ next: { subjectName: 'Maths', teacherName: 'X Y', startTime: '08:00' }, todayStatus: null })} />,
    );
    expect(queryByText(/Present today|Late today|Absent today/)).toBeNull();
  });
});
