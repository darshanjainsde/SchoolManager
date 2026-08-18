import { render } from '@testing-library/react-native';
import type { MeLibraryPayload } from '@skoolos/types';
import { ApiError, api } from '@/lib/api';
import FamilyLibrary from '../(tabs)/library';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const requestMock = api.request as jest.Mock;

const SHELF: MeLibraryPayload = {
  kind: 'STUDENT',
  limit: 2,
  loanDays: 14,
  finesEnabled: true,
  holdings: [
    {
      issueId: 'i1', title: 'Matilda', author: 'Roald Dahl', accessionNo: 'B-00042',
      issuedOn: '2026-08-04', dueOn: '2026-08-19', daysLeft: 2, accruedFineRupees: 0,
    },
    {
      issueId: 'i2', title: 'Wonder', author: 'R.J. Palacio', accessionNo: 'B-00077',
      issuedOn: '2026-07-30', dueOn: '2026-08-14', daysLeft: -3, accruedFineRupees: 10,
    },
  ],
  history: [
    { issueId: 'i3', title: 'The BFG', author: 'Roald Dahl', returnedOn: '2026-07-28', wasLost: false },
  ],
  fines: [{ id: 'f1', title: 'Hatchet', reason: 'LOST', amountRupees: 120 }],
  finesDueRupees: 130,
  today: '2026-08-17',
};

beforeEach(() => requestMock.mockReset());

it('shows the limit, each book with its worded chip and ribbon, fines pinned to the shelf', async () => {
  requestMock.mockResolvedValue(SHELF);
  const { findByText, getByText, getByTestId, getAllByTestId } = render(<FamilyLibrary />);

  expect(await findByText('Holding 2 of 2')).toBeTruthy();
  expect(getByText('return one to borrow more')).toBeTruthy();
  // Words, not just colour — and the fine rides the exact book that earned it.
  expect(getByText('2 days left — due 19 Aug')).toBeTruthy();
  expect(getByText('3 days late · ₹10 so far')).toBeTruthy();
  expect(getByTestId('fine-banner')).toBeTruthy();
  expect(getByText('₹130 to clear at the counter')).toBeTruthy();
  // One ribbon per book, toned by urgency.
  expect(getAllByTestId('ribbon-amber')).toHaveLength(1);
  expect(getAllByTestId('ribbon-red')).toHaveLength(1);
  expect(getByText('The BFG')).toBeTruthy();
});

it('hides the fine banner entirely when nothing is owed', async () => {
  requestMock.mockResolvedValue({
    ...SHELF,
    finesDueRupees: 0,
    fines: [],
    holdings: [SHELF.holdings[0]],
  });
  const { findByText, queryByTestId, getByText } = render(<FamilyLibrary />);
  expect(await findByText('Holding 1 of 2')).toBeTruthy();
  expect(getByText('you can borrow 1 more')).toBeTruthy();
  expect(queryByTestId('fine-banner')).toBeNull();
});

it('says so quietly when the plan has no library (403) instead of erroring', async () => {
  requestMock.mockRejectedValue(new ApiError(403, 'forbidden'));
  const { findByText } = render(<FamilyLibrary />);
  expect(await findByText(/isn’t part of this school’s plan/)).toBeTruthy();
});

it('surfaces a real failure as the message, not a blank screen', async () => {
  requestMock.mockRejectedValue(new ApiError(0, 'Could not reach the school server.'));
  const { findByText } = render(<FamilyLibrary />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});
