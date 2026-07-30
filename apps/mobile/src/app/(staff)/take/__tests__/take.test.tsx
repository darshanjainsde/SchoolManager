import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TakeAttendance from '../[classSectionId]';
import { api } from '@/lib/api';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => ({ classSectionId: 'cs1', name: '5-B' }),
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const MARKS = [
  { studentId: 's1', status: 'PRESENT' },
  { studentId: 's2', status: 'ABSENT' },
];
const STUDENTS = [
  { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 's2', firstName: 'Ben', lastName: 'Lee', rollNo: '2' },
];

beforeEach(() => {
  mockBack.mockReset();
  (api.request as jest.Mock).mockReset();
});

it('joins attendance marks with student roster names and defaults unmarked students to present', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText } = render(<TakeAttendance />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(await findByText('Ben Lee')).toBeTruthy();
  expect(await findByText(/1 present · 1 absent · 2 total/)).toBeTruthy();
});

it('toggling a student and submitting sends the exact PUT contract', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 1 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  const markPresent = await findByTestId('present-s2');
  fireEvent.press(markPresent);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);

  await waitFor(() => expect(mockBack).toHaveBeenCalled());

  const putCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/attendance');
  expect(putCall[1]).toMatchObject({
    method: 'PUT',
    body: {
      classSectionId: 'cs1',
      marks: [
        { studentId: 's1', status: 'PRESENT' },
        { studentId: 's2', status: 'PRESENT' },
      ],
    },
  });
  expect(putCall[1].body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('loads a LATE student as LATE, not as present', async () => {
  // The bug: `present: status !== 'ABSENT'` rendered LATE as Present, and the
  // next save rewrote it to PRESENT — destroying a mark made on the web.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's1', status: 'LATE' }]);
    }
    if (path.startsWith('/manage/students?')) {
      return Promise.resolve([{ id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' }]);
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  const lateButton = await findByTestId('late-s1');
  // The selected pill for a LATE student must be Late, not Present.
  expect(lateButton.props.style).toMatchObject({ backgroundColor: '#F59E0B' });
  const presentButton = await findByTestId('present-s1');
  expect(presentButton.props.style).not.toMatchObject({ backgroundColor: '#16B364' });
});

it('submitting a roster with a LATE student sends LATE', async () => {
  // Assert on the PUT body, not on the UI.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's1', status: 'LATE' }]);
    }
    if (path.startsWith('/manage/students?')) {
      return Promise.resolve([{ id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' }]);
    }
    if (path === '/manage/attendance') return Promise.resolve({ saved: 1, absentees: 0 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  // Wait for the roster row to render before pressing submit — until then
  // the button is disabled (rows.length === 0) and the press is a no-op.
  await findByTestId('late-s1');
  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);

  await waitFor(() => expect(mockBack).toHaveBeenCalled());

  const putCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/attendance');
  expect(putCall[1]).toMatchObject({
    method: 'PUT',
    body: { classSectionId: 'cs1', marks: [{ studentId: 's1', status: 'LATE' }] },
  });
});
