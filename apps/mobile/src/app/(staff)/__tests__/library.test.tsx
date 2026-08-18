import { render } from '@testing-library/react-native';
import type { MeLibraryPayload } from '@skoolos/types';
import { api } from '@/lib/api';
import StaffLibrary from '../(tabs)/library';

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

const BASE: MeLibraryPayload = {
  kind: 'TEACHER',
  limit: 5,
  loanDays: 14,
  finesEnabled: false,
  holdings: [
    {
      issueId: 'i1', title: 'A Brief History of Time', author: 'Stephen Hawking', accessionNo: 'B-00901',
      issuedOn: '2026-08-05', dueOn: '2026-08-20', daysLeft: 3, accruedFineRupees: 0,
    },
  ],
  history: [
    { issueId: 'i2', title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', returnedOn: '2026-08-02', wasLost: false },
  ],
  fines: [],
  finesDueRupees: 0,
  today: '2026-08-17',
};

beforeEach(() => requestMock.mockReset());

it('shows holdings and history — and NO fines section while teacher fines are off', async () => {
  requestMock.mockResolvedValue(BASE);
  const { findByText, getByText, queryByText } = render(<StaffLibrary />);

  expect(await findByText('A Brief History of Time')).toBeTruthy();
  expect(getByText('Holding now · 1 of 5')).toBeTruthy();
  expect(getByText('Wings of Fire')).toBeTruthy();
  // The rule itself, not an empty list: the section is absent.
  expect(queryByText('Fines')).toBeNull();
});

it('grows a fines section with amounts the moment the librarian turns teacher fines on', async () => {
  requestMock.mockResolvedValue({
    ...BASE,
    finesEnabled: true,
    fines: [{ id: 'f1', title: 'Godaan', reason: 'LATE', amountRupees: 15 }],
    finesDueRupees: 15,
  });
  const { findByText, getByText } = render(<StaffLibrary />);

  expect(await findByText('Fines')).toBeTruthy();
  expect(getByText('Godaan')).toBeTruthy();
  expect(getByText('₹15')).toBeTruthy();
  expect(getByText('₹15 due — pay at the counter.')).toBeTruthy();
});
