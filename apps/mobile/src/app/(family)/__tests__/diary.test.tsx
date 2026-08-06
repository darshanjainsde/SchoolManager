import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import FamilyDiary from '../(tabs)/home/diary';
import { api } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const ITEM = {
  id: 'e1',
  date: '2026-08-03',
  kind: 'ITEM' as const,
  body: 'Maths worksheet 7.3.',
  subjectName: 'Mathematics',
  teacherName: 'Meera Iyer',
  personal: false,
  signedAt: null,
  signedName: null,
  createdAt: '2026-08-03T09:00:00.000Z',
};
const REMARK = {
  ...ITEM,
  id: 'e2',
  kind: 'REMARK' as const,
  body: 'Disrupted the lesson twice today.',
  personal: true,
};

let signBody: Record<string, unknown> | null = null;

function mockApi(result: { entries: unknown[]; unsignedCount: number }) {
  signBody = null;
  (api.request as jest.Mock).mockImplementation(
    (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
      if (path.endsWith('/sign')) {
        signBody = init?.body ?? null;
        return Promise.resolve({
          id: 'e2',
          signedAt: '2026-08-03T18:00:00.000Z',
          signedName: init?.body?.signedName,
          unsignedCount: 0,
        });
      }
      return Promise.resolve(result);
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows the day’s page and counts what still needs signing', async () => {
  mockApi({ entries: [ITEM, REMARK], unsignedCount: 1 });
  const { getByTestId, getByText } = render(<FamilyDiary />);

  await settled(() => expect(getByTestId('diary-e1')).toBeTruthy());
  expect(getByText('Maths worksheet 7.3.')).toBeTruthy();
  expect(getByTestId('diary-unsigned')).toBeTruthy();
  expect(getByText('1 to sign')).toBeTruthy();
});

it('an ordinary entry has no signature line — only a remark asks for one', async () => {
  mockApi({ entries: [ITEM], unsignedCount: 0 });
  const { getByTestId, queryByTestId } = render(<FamilyDiary />);

  await settled(() => expect(getByTestId('diary-e1')).toBeTruthy());
  expect(queryByTestId('sign-e1')).toBeNull();
});

it('signing a remark sends the typed name and flips the card to signed', async () => {
  mockApi({ entries: [REMARK], unsignedCount: 1 });
  const { getByTestId, queryByTestId, getByText } = render(<FamilyDiary />);

  await settled(() => expect(getByTestId('sign-e2')).toBeTruthy());
  // Honest that the email already went out — and role-neutral, since one
  // STUDENT login serves both the student and whoever at home uses it.
  expect(getByText(/already been emailed home/i)).toBeTruthy();

  fireEvent.changeText(getByTestId('sign-name-e2'), 'Priya Sharma');
  fireEvent.press(getByTestId('sign-e2'));

  await settled(() => expect(signBody).toEqual({ signedName: 'Priya Sharma' }));
  await settled(() => expect(getByTestId('signed-e2')).toBeTruthy());
  expect(queryByTestId('sign-e2')).toBeNull();
  expect(getByText('by Priya Sharma')).toBeTruthy();
});

it('will not sign with an empty name', async () => {
  mockApi({ entries: [REMARK], unsignedCount: 1 });
  const { getByTestId } = render(<FamilyDiary />);

  await settled(() => expect(getByTestId('sign-e2')).toBeTruthy());
  fireEvent.press(getByTestId('sign-e2'));

  await flush();
  expect(signBody).toBeNull();
});
