import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { AttendanceStatusValue } from '@skoolos/types';
import ClassScreen from '../(tabs)/home/class/[classSectionId]';
import { api, ApiError } from '@/lib/api';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const ROSTER = [
  { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 's2', firstName: 'Ben', lastName: 'Miller', rollNo: '2' },
  { id: 's3', firstName: 'Chandni', lastName: 'Patel', rollNo: '3' },
  { id: 's4', firstName: 'Dev', lastName: 'Kumar', rollNo: null },
];

function mockClass(marks: Array<{ studentId: string; status: AttendanceStatusValue }> | Error) {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance')) {
      return marks instanceof Error ? Promise.reject(marks) : Promise.resolve(marks);
    }
    if (path.startsWith('/manage/students')) return Promise.resolve(ROSTER);
    throw new Error(`unexpected call: ${path}`);
  });
}

beforeEach(() => {
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
  mockParams = {
    classSectionId: 'sec-8a',
    name: '8-A',
    subject: 'Mathematics',
    period: 'P3',
    start: '10:35',
    end: '11:20',
  };
});

it('names the class, the subject and when it runs from the params Home already had', async () => {
  // Nothing here is refetched: Home is holding the whole TeacherDayEntry when
  // it navigates, so inventing a lookup endpoint for the header would be work
  // to rediscover something we just threw away.
  mockClass([]);
  render(<ClassScreen />);

  expect(await screen.findByText('8-A · Mathematics')).toBeTruthy();
  expect(screen.getByText('P3 · 10:35–11:20')).toBeTruthy();
});

it('shows every pupil by NAME — which is the whole reason this screen exists', async () => {
  // The register is a grid of numbered squares so it can be marked at walking
  // pace; dropping the names is what makes it fast. This is where the names
  // live instead.
  mockClass([]);
  render(<ClassScreen />);

  const roster = await screen.findByTestId('class-roster');
  expect(within(roster).getByText('Asha Rao')).toBeTruthy();
  expect(within(roster).getByText('Dev Kumar')).toBeTruthy();
  expect(within(roster).getByText('Everyone · 4')).toBeTruthy();
});

it('before the register is taken, nobody wears a status chip', async () => {
  // The server defaults an unmarked pupil to PRESENT, so a naive render puts
  // an identical green "Present" chip on all thirty rows — which looks exactly
  // like a marked register and is a lie about a class nobody has looked at.
  mockClass([]);
  render(<ClassScreen />);

  expect(await screen.findByText('Register not taken · 4 students')).toBeTruthy();
  expect(screen.queryByText('Present')).toBeNull();
  expect(screen.getByText('Take register →')).toBeTruthy();
});

it('once marked, leads with who is NOT in the room', async () => {
  // Scanning thirty green rows to find the two red ones is work this screen
  // should already have done.
  mockClass([
    { studentId: 's1', status: 'PRESENT' },
    { studentId: 's2', status: 'ABSENT' },
    { studentId: 's3', status: 'LATE' },
    { studentId: 's4', status: 'PRESENT' },
  ]);
  render(<ClassScreen />);

  const out = await screen.findByTestId('class-exceptions');
  expect(within(out).getByText('Ben Miller')).toBeTruthy();
  expect(within(out).getByText('Chandni Patel')).toBeTruthy();
  expect(within(out).queryByText('Asha Rao')).toBeNull();

  expect(screen.getByText('2 of 4 present')).toBeTruthy();
  expect(screen.getByTestId('class-register-detail').props.children).toContain('1 absent');
});

it('does not draw a "not in the room" block when everyone is in', async () => {
  mockClass(ROSTER.map((s) => ({ studentId: s.id, status: 'PRESENT' as const })));
  render(<ClassScreen />);

  expect(await screen.findByText('4 of 4 present')).toBeTruthy();
  expect(screen.queryByTestId('class-exceptions')).toBeNull();
  expect(screen.getByTestId('class-register-detail').props.children).toContain('Nobody absent');
});

it('reads "taken" from the marks, not from the param Home linked with', async () => {
  // `takenBy` describes what Home knew when it drew the tile. A colleague may
  // have marked the register in the seconds since, so the rows are the truth
  // and the button says Edit rather than Take.
  mockParams = { ...mockParams, takenBy: undefined as unknown as string };
  mockClass([
    { studentId: 's1', status: 'PRESENT' },
    { studentId: 's2', status: 'ABSENT' },
    { studentId: 's3', status: 'PRESENT' },
    { studentId: 's4', status: 'PRESENT' },
  ]);
  render(<ClassScreen />);

  expect(await screen.findByText('Edit register →')).toBeTruthy();
  expect(screen.queryByText('Take register →')).toBeNull();
});

it('carries the class name through to the register so its header is not blank', async () => {
  mockClass([]);
  render(<ClassScreen />);

  fireEvent.press(await screen.findByTestId('class-take'));
  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/sec-8a?name=8-A');
});

it('carries the class and subject through to the notes screen', async () => {
  mockClass([]);
  render(<ClassScreen />);

  fireEvent.press(await screen.findByTestId('class-notes'));
  expect(mockPush).toHaveBeenCalledWith(
    '/(staff)/(tabs)/home/notes/sec-8a?className=8-A&subjectName=Mathematics',
  );
});

it('shows the server message verbatim when the class cannot be read', async () => {
  mockClass(new ApiError(403, 'You do not teach this class.'));
  render(<ClassScreen />);

  expect(await screen.findByText('You do not teach this class.')).toBeTruthy();
  expect(screen.queryByTestId('class-roster')).toBeNull();
});

it('says so when the class has no pupils rather than drawing an empty page', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/manage/students') ? [] : []),
  );
  render(<ClassScreen />);

  expect(await screen.findByText(/No students in this class yet/)).toBeTruthy();
});
