import { render } from '@testing-library/react-native';
import Profile from '../profile';
import { api, ApiError } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

it('renders name, email, phone, subjects and class-teacher-of from GET /manage/teachers/me', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha.rao@raffles.sckools.com',
    phone: '+91 98765 43210',
    subjects: ['Mathematics', 'Physics'],
    classTeacherOf: ['8-C'],
  });

  const { findByText } = render(<Profile />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(await findByText('asha.rao@raffles.sckools.com')).toBeTruthy();
  expect(await findByText('+91 98765 43210')).toBeTruthy();
  expect(await findByText('Mathematics')).toBeTruthy();
  expect(await findByText('Physics')).toBeTruthy();
  expect(await findByText('8-C')).toBeTruthy();

  expect((api.request as jest.Mock).mock.calls[0][0]).toBe('/manage/teachers/me');
});

it('shows "Not on file" for a missing email or phone, and honest empty states for no subjects / not a class teacher', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't2',
    firstName: 'Vikram',
    lastName: 'Singh',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
  });

  const { findAllByText, findByText } = render(<Profile />);

  expect(await findByText('Vikram Singh')).toBeTruthy();
  expect(await findAllByText('Not on file')).toHaveLength(2);
  expect(await findByText('No subjects assigned')).toBeTruthy();
  expect(await findByText('Not a class teacher')).toBeTruthy();
});

it('shows the API error message when the fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Profile />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

/**
 * v1 scope decision (task-10-brief.md): password change is web-only for
 * now. The screen must say so rather than silently omitting the control —
 * the same "every screen handles ... honestly" bar as everything else in
 * this app.
 */
it('points a teacher at the web portal for password changes, not a broken control', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
  });

  const { findByText } = render(<Profile />);

  expect(await findByText('Change your password on the web portal.')).toBeTruthy();
});
