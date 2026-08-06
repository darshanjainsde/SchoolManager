import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import StaffDiary from '../diary';
import { api } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  // Deps are [effect], NOT [] — the real useFocusEffect re-runs whenever the
  // callback's identity changes, which is how this screen loads the page once
  // `classId` resolves. An `[]` mock would freeze it on the first render.
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const CLASSES = [{ classSectionId: 'cs1', name: 'Grade 8-C', studentCount: 28, covering: false }];
const ROSTER = [
  { id: 'stu-aarav', firstName: 'Aarav', lastName: 'Sharma', rollNo: '1' },
  { id: 'stu-diya', firstName: 'Diya', lastName: 'Rao', rollNo: '2' },
];
const ENTRY = {
  id: 'e1',
  date: '2026-08-03',
  kind: 'ITEM' as const,
  audience: 'ALL' as const,
  body: 'Maths worksheet 7.3.',
  subjectId: null,
  subjectName: null,
  authorTeacherId: 't1',
  authorName: 'Meera Iyer',
  students: [],
  seenCount: 12,
  signedCount: 0,
  recipientCount: 28,
  createdAt: '2026-08-03T09:00:00.000Z',
  editable: true,
};

let created: Record<string, unknown> | null = null;

function mockApi(page: { entries: unknown[] } = { entries: [] }) {
  created = null;
  (api.request as jest.Mock).mockImplementation(
    (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
      if (path.startsWith('/manage/attendance/my-classes')) return Promise.resolve(CLASSES);
      if (path.startsWith('/manage/students')) return Promise.resolve(ROSTER);
      if (path.startsWith('/manage/diary') && init?.method === 'POST') {
        created = init.body ?? null;
        return Promise.resolve({
          ...ENTRY,
          id: 'new',
          kind: init.body?.kind,
          audience: init.body?.audience,
          body: init.body?.body,
          students:
            (init.body?.studentIds as string[] | undefined)?.map((id) => ({
              studentId: id,
              name: ROSTER.find((r) => r.id === id)?.firstName ?? id,
            })) ?? [],
        });
      }
      if (path.startsWith('/manage/diary'))
        return Promise.resolve({
          date: '2026-08-03',
          classSectionId: 'cs1',
          className: 'Grade 8-C',
          entries: page.entries,
        });
      return Promise.resolve({});
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows the day’s entries with their read receipts', async () => {
  mockApi({ entries: [ENTRY] });
  const { getByTestId, getByText } = render(<StaffDiary />);

  await settled(() => expect(getByTestId('diary-entry-e1')).toBeTruthy());
  expect(getByText('Maths worksheet 7.3.')).toBeTruthy();
  expect(getByText(/12\/28 opened/)).toBeTruthy();
});

it('an entry with nobody named goes to the whole class', async () => {
  mockApi();
  const { getByTestId } = render(<StaffDiary />);
  await settled(() => expect(getByTestId('diary-compose')).toBeTruthy());

  fireEvent.changeText(getByTestId('diary-body'), 'Bring your art file tomorrow.');
  fireEvent.press(getByTestId('diary-send'));

  await settled(() =>
    expect(created).toMatchObject({
      kind: 'ITEM',
      audience: 'ALL',
      body: 'Bring your art file tomorrow.',
    }),
  );
  expect(created).not.toHaveProperty('studentIds');
});

it('typing a name and tapping the match turns it into a token the entry is sent to', async () => {
  mockApi();
  const { getByTestId, queryByTestId } = render(<StaffDiary />);
  await settled(() => expect(getByTestId('diary-compose')).toBeTruthy());

  fireEvent.changeText(getByTestId('diary-picker-input'), 'aar');
  await settled(() => expect(getByTestId('match-stu-aarav')).toBeTruthy());
  fireEvent.press(getByTestId('match-stu-aarav'));

  // The child is now a removable token — and the drawer deliberately STAYS
  // OPEN with the row ticked (multi-pick from one drawer: "an" → Anjali,
  // Anjana, Ankur is three taps; the query survives every one of them).
  await settled(() => expect(getByTestId('token-stu-aarav')).toBeTruthy());
  expect(getByTestId('diary-picker-matches')).toBeTruthy();
  expect(getByTestId('match-picked-stu-aarav')).toBeTruthy();
  expect(queryByTestId('diary-picker-empty')).toBeNull();

  fireEvent.changeText(getByTestId('diary-body'), 'Please bring the signed form.');
  fireEvent.press(getByTestId('diary-send'));

  await settled(() =>
    expect(created).toMatchObject({ audience: 'SELECTED', studentIds: ['stu-aarav'] }),
  );
});

it('a remark cannot be sent until somebody is named, and says the parents are emailed', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<StaffDiary />);
  await settled(() => expect(getByTestId('diary-compose')).toBeTruthy());

  fireEvent.press(getByTestId('diary-kind-REMARK'));
  fireEvent.changeText(getByTestId('diary-body'), 'Disrupted the lesson twice today.');
  expect(getByText(/always emailed to the parents/i)).toBeTruthy();

  // No names yet — pressing does nothing.
  fireEvent.press(getByTestId('diary-send'));
  await flush();
  expect(created).toBeNull();

  fireEvent.changeText(getByTestId('diary-picker-input'), 'diya');
  await settled(() => expect(getByTestId('match-stu-diya')).toBeTruthy());
  fireEvent.press(getByTestId('match-stu-diya'));
  fireEvent.press(getByTestId('diary-send'));

  await settled(() =>
    expect(created).toMatchObject({ kind: 'REMARK', studentIds: ['stu-diya'] }),
  );
  await settled(() => expect(getByTestId('diary-sent')).toBeTruthy());
});

it('a past page has no compose card at all — it explains why instead', async () => {
  mockApi({ entries: [ENTRY] });
  const { getByTestId, queryByTestId, getByText } = render(<StaffDiary />);
  await settled(() => expect(getByTestId('diary-compose')).toBeTruthy());

  fireEvent.press(getByTestId('diary-prev'));

  await settled(() => expect(queryByTestId('diary-compose')).toBeNull());
  expect(getByText(/cannot be rewritten/i)).toBeTruthy();
});
