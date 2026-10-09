import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import ResetByCode from '../reset-by-code';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    back: (...a: unknown[]) => mockBack(...a),
    canGoBack: () => mockCanGoBack(),
    push: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, resetByCode: jest.fn(), resolveSchool: jest.fn() } };
});

beforeEach(async () => {
  jest.clearAllMocks();
  // The screen resolves the school from the code itself now (the connect
  // screen is gone); the stored host is only a fallback.
  (api.resolveSchool as jest.Mock).mockResolvedValue(['raffles.sckools.com']);
  await session.setSchoolHost('raffles.sckools.com');
});

it('will not send until the code looks like one the school printed', async () => {
  const { getByTestId } = render(<ResetByCode />);

  fireEvent.changeText(getByTestId('reset-code'), 'RAF');
  fireEvent.press(getByTestId('reset-send'));
  await flush();
  expect(api.resetByCode).not.toHaveBeenCalled();

  fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
  fireEvent.press(getByTestId('reset-send'));
  await settled(() =>
    expect(api.resetByCode).toHaveBeenCalledWith('raffles.sckools.com', 'RAF-00042'),
  );
});

it('lower-case entry is normalised — the letter prints upper case', async () => {
  (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: 'p•••a@gmail.com' });
  const { getByTestId } = render(<ResetByCode />);

  fireEvent.changeText(getByTestId('reset-code'), 'raf-00042');
  fireEvent.press(getByTestId('reset-send'));

  await settled(() =>
    expect(api.resetByCode).toHaveBeenCalledWith('raffles.sckools.com', 'RAF-00042'),
  );
});

it('names the masked inbox the link went to', async () => {
  (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: 'p•••a@gmail.com' });
  const { getByTestId } = render(<ResetByCode />);

  fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
  fireEvent.press(getByTestId('reset-send'));

  await settled(() => expect(getByTestId('reset-result')).toBeTruthy());
  expect(getByTestId('reset-result').props.children).toContain('p•••a@gmail.com');
});

it('says to ring the office when the code has no email on file — never a false success', async () => {
  (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: null });
  const { getByTestId, getByText } = render(<ResetByCode />);

  fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
  fireEvent.press(getByTestId('reset-send'));

  await settled(() => expect(getByText(/ring the school office/i)).toBeTruthy());
});

it('surfaces a rate-limit / server refusal instead of pretending it sent', async () => {
  (api.resetByCode as jest.Mock).mockRejectedValue(new ApiError(429, 'Too many attempts.'));
  const { getByTestId, getByText, queryByTestId } = render(<ResetByCode />);

  fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
  fireEvent.press(getByTestId('reset-send'));

  await settled(() => expect(getByText('Too many attempts.')).toBeTruthy());
  expect(queryByTestId('reset-result')).toBeNull();
});

describe('the latest UI — the login card, not the old gradient (9 Oct 2026)', () => {
  it('sits in the same gate card as login, with a key and a round back button', () => {
    const { getByTestId, getByText } = render(<ResetByCode />);
    expect(getByTestId('gate-sheet')).toBeTruthy();
    expect(getByTestId('gate-icon')).toBeTruthy();
    expect(getByText('Forgot the password?')).toBeTruthy();
    const back = getByTestId('reset-back-top');
    const st = back.props.style;
    expect(st.width).toBeGreaterThanOrEqual(44);
    expect(st.height).toBeGreaterThanOrEqual(44);
  });

  it('the back button returns to login — and still gets there when there is no history', () => {
    const { getByTestId } = render(<ResetByCode />);
    fireEvent.press(getByTestId('reset-back-top'));
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack.mockReturnValueOnce(false);
    fireEvent.press(getByTestId('reset-cancel'));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('the keyboard Send key sends too', async () => {
    (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: 'p•••a@gmail.com' });
    const { getByTestId } = render(<ResetByCode />);
    fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
    fireEvent(getByTestId('reset-code'), 'submitEditing');
    await settled(() => expect(api.resetByCode).toHaveBeenCalledWith('raffles.sckools.com', 'RAF-00042'));
  });

  it('after a link is sent, "Use a different code" starts again with an empty field', async () => {
    (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: 'p•••a@gmail.com' });
    const { getByTestId, findByTestId, getByText } = render(<ResetByCode />);
    fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
    fireEvent.press(getByTestId('reset-send'));
    fireEvent.press(await findByTestId('reset-again'));
    expect((await findByTestId('reset-code')).props.value).toBe('');
  });

  it('no email on file reads as its own amber answer, never "Check the inbox"', async () => {
    (api.resetByCode as jest.Mock).mockResolvedValue({ ok: true, emailMasked: null });
    const { getByTestId, findByText, queryByText, queryByTestId } = render(<ResetByCode />);
    fireEvent.changeText(getByTestId('reset-code'), 'RAF-00042');
    fireEvent.press(getByTestId('reset-send'));
    expect(await findByText('No email on file')).toBeTruthy();
    expect(queryByText('Check the inbox')).toBeNull();
    expect(queryByTestId('reset-again')).toBeNull();
  });
});
