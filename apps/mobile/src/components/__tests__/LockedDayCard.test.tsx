import { fireEvent, render } from '@testing-library/react-native';
import { LockedDayCard } from '../LockedDayCard';

const STATUS_TAKEN = {
  classSectionId: 'cs1',
  name: '5-B',
  total: 28,
  present: 24,
  taken: true,
  markedBy: 'Mr. Rao',
  markedAt: '2026-07-23T05:00:00.000Z',
};

const baseProps = {
  testID: 'locked-day-cs1',
  className: '5-B',
  date: '2026-07-23',
  status: null,
  requestPending: false,
  requestsLoading: false,
  isSubmitting: false,
  onRequestChange: jest.fn(),
};

it('shows the day\'s counts when the register exists', () => {
  const { getByText } = render(<LockedDayCard {...baseProps} status={STATUS_TAKEN} />);
  expect(getByText(/24 of 28 present/)).toBeTruthy();
  expect(getByText(/Mr\. Rao/)).toBeTruthy();
});

it('shows an explicit no-record state when nothing was recorded', () => {
  const { getByText, queryByText } = render(<LockedDayCard {...baseProps} status={null} />);
  expect(getByText('No attendance was recorded for that day.')).toBeTruthy();
  expect(queryByText(/present/)).toBeNull();
});

it('shows a "checking" state and no form while requests are loading', () => {
  const { getByTestId, queryByTestId } = render(
    <LockedDayCard {...baseProps} requestsLoading />,
  );
  expect(getByTestId('locked-day-cs1-loading')).toBeTruthy();
  expect(queryByTestId('locked-day-cs1-reason')).toBeNull();
  expect(queryByTestId('locked-day-cs1-submit')).toBeNull();
  expect(queryByTestId('locked-day-cs1-pending')).toBeNull();
});

it('shows the pending state and no form when a request is already open', () => {
  const { getByTestId, queryByTestId, getByText } = render(
    <LockedDayCard {...baseProps} requestPending />,
  );
  expect(getByTestId('locked-day-cs1-pending')).toBeTruthy();
  expect(getByText(/waiting on your admin/i)).toBeTruthy();
  expect(queryByTestId('locked-day-cs1-reason')).toBeNull();
});

it('a whitespace-only reason does not call onRequestChange', () => {
  const onRequestChange = jest.fn();
  const { getByTestId } = render(
    <LockedDayCard {...baseProps} onRequestChange={onRequestChange} />,
  );
  fireEvent.changeText(getByTestId('locked-day-cs1-reason'), '   ');
  fireEvent.press(getByTestId('locked-day-cs1-submit'));
  expect(onRequestChange).not.toHaveBeenCalled();
});

it('submits the trimmed reason', () => {
  const onRequestChange = jest.fn();
  const { getByTestId } = render(
    <LockedDayCard {...baseProps} onRequestChange={onRequestChange} />,
  );
  fireEvent.changeText(getByTestId('locked-day-cs1-reason'), '  Forgot to mark it  ');
  fireEvent.press(getByTestId('locked-day-cs1-submit'));
  expect(onRequestChange).toHaveBeenCalledWith('Forgot to mark it');
});

it('disables the submit button while isSubmitting and shows the busy label', () => {
  const { getByTestId, getByText } = render(<LockedDayCard {...baseProps} isSubmitting />);
  expect(getByText('Requesting…')).toBeTruthy();
  expect(getByTestId('locked-day-cs1-submit').props.accessibilityState?.disabled).toBe(true);
});

it('shows the server error message verbatim', () => {
  const { getByTestId } = render(
    <LockedDayCard {...baseProps} error="You already have a request open for that day." />,
  );
  expect(getByTestId('locked-day-cs1-error').props.children).toBe(
    'You already have a request open for that day.',
  );
});
