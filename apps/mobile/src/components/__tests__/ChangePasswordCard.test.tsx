import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChangePasswordCard } from '../ChangePasswordCard';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const request = api.request as jest.Mock;

function fill(getByTestId: (id: string) => unknown, current: string, next: string, confirm: string) {
  fireEvent.changeText(getByTestId('pw-current') as never, current);
  fireEvent.changeText(getByTestId('pw-new') as never, next);
  fireEvent.changeText(getByTestId('pw-confirm') as never, confirm);
}

beforeEach(() => request.mockReset());

it('a successful change hits the endpoint and clears every field', async () => {
  request.mockResolvedValue({ ok: true });
  const { getByTestId, findByText } = render(<ChangePasswordCard />);

  fill(getByTestId, 'old-secret', 'new-secret-9', 'new-secret-9');
  fireEvent.press(getByTestId('pw-submit'));

  expect(await findByText('Password changed.')).toBeTruthy();
  expect(request).toHaveBeenCalledWith('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: 'old-secret', newPassword: 'new-secret-9' },
  });
  // A password must not linger on a screen that stays open.
  expect((getByTestId('pw-current') as { props: { value: string } }).props.value).toBe('');
  expect((getByTestId('pw-new') as { props: { value: string } }).props.value).toBe('');
});

it('mismatched new passwords are refused locally — no request is made', async () => {
  const { getByTestId, findByText } = render(<ChangePasswordCard />);

  fill(getByTestId, 'old-secret', 'new-secret-9', 'different-9');
  fireEvent.press(getByTestId('pw-submit'));

  expect(await findByText(/do not match/i)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it('a short new password is refused locally — no request is made', async () => {
  const { getByTestId, findByText } = render(<ChangePasswordCard />);

  fill(getByTestId, 'old-secret', 'short', 'short');
  fireEvent.press(getByTestId('pw-submit'));

  // Assert on the ERROR toast, not a bare text match — the rule's hint line
  // says "at least 8 characters" too, permanently.
  const toast = await waitFor(() => getByTestId('pw-error'));
  expect(toast).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it('a server refusal (wrong current password) surfaces its message verbatim and keeps the fields', async () => {
  const { ApiError } = jest.requireActual('@/lib/api');
  request.mockRejectedValue(new ApiError(401, 'Current password is incorrect'));
  const { getByTestId, findByText, queryByText } = render(<ChangePasswordCard />);

  fill(getByTestId, 'wrong-old', 'new-secret-9', 'new-secret-9');
  fireEvent.press(getByTestId('pw-submit'));

  expect(await findByText('Current password is incorrect')).toBeTruthy();
  expect(queryByText('Password changed.')).toBeNull();
  // The typed values survive a refusal — retyping three fields to fix one
  // wrong character would be punishment, not security.
  expect((getByTestId('pw-new') as { props: { value: string } }).props.value).toBe('new-secret-9');
});
