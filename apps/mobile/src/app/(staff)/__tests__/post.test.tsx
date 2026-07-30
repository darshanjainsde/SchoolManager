import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Post from '../post';
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

const CLASSES = [
  { classSectionId: 'cs1', name: 'Grade 5-B', studentCount: 28 },
  { classSectionId: 'cs2', name: 'Grade 6-A', studentCount: 31 },
];

const ANNOUNCEMENT = {
  id: 'ann-1',
  title: 'Reminder',
  body: 'Bring your workbook tomorrow.',
  classSectionId: 'cs1',
  className: 'Grade 5-B',
  createdAt: '2026-07-01T09:00:00.000Z',
};

/**
 * Both `GET /manage/attendance/my-classes` and `GET
 * /manage/announcements/mine` go through the same mocked `api.request` — a
 * blanket `mockResolvedValue` would answer both calls identically. Route by
 * path so the "Your recent posts" list gets its own, correctly-shaped data
 * (or an empty list when a test doesn't care about it).
 */
function mockRequest(routes: {
  classes?: unknown[] | Error;
  mine?: unknown[] | Error;
  onOther?: (path: string, init?: unknown) => unknown;
}) {
  return jest.fn().mockImplementation((path: string, init?: unknown) => {
    if (path === '/manage/attendance/my-classes') {
      if (routes.classes instanceof Error) return Promise.reject(routes.classes);
      return Promise.resolve(routes.classes ?? CLASSES);
    }
    if (path === '/manage/announcements/mine') {
      if (routes.mine instanceof Error) return Promise.reject(routes.mine);
      return Promise.resolve(routes.mine ?? []);
    }
    if (routes.onOther) return routes.onOther(path, init);
    throw new Error(`unexpected path: ${path}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('disables the submit button until a class, title and details are all filled in', async () => {
  (api.request as jest.Mock).mockImplementation(mockRequest({ classes: CLASSES, mine: [] }));
  const { findByTestId, findByText } = render(<Post />);

  const submit = await findByTestId('post-submit');
  expect(submit.props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(await findByText('Grade 5-B'));
  expect(submit.props.accessibilityState?.disabled).toBe(true); // still no title/body

  fireEvent.changeText(await findByTestId('post-title'), 'Test title');
  fireEvent.changeText(await findByTestId('post-body'), 'Test body');
  expect(submit.props.accessibilityState?.disabled).toBe(false);
});

it('posts the exact {title, body, classSectionIds} contract for the selected classes, clears the form, and refreshes the recent-posts list', async () => {
  const request = jest.fn().mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
    if (path === '/manage/announcements/mine') return Promise.resolve([]);
    if (path === '/manage/announcements') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId, findByText, queryByText } = render(<Post />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByText('Grade 6-A'));
  fireEvent.changeText(await findByTestId('post-title'), 'PTM this Saturday');
  fireEvent.changeText(await findByTestId('post-body'), 'Please attend at 10 AM.');

  const callsBefore = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

  const submit = await findByTestId('post-submit');
  expect(await findByText('Post to 2 classes')).toBeTruthy();
  fireEvent.press(submit);

  await waitFor(() => expect(queryByText('Posted ✓')).toBeTruthy());

  const postCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/announcements');
  expect(postCall[1]).toEqual({
    method: 'POST',
    body: {
      title: 'PTM this Saturday',
      body: 'Please attend at 10 AM.',
      classSectionIds: ['cs1', 'cs2'],
    },
  });

  // Form clears and re-disables after a successful post.
  expect(await findByText('Post to 0 classes')).toBeTruthy();

  await waitFor(() => {
    const callsAfter = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

it('shows the API error message when posting fails', async () => {
  const request = jest.fn().mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
    if (path === '/manage/announcements/mine') return Promise.resolve([]);
    if (path === '/manage/announcements')
      return Promise.reject(new ApiError(403, 'You can only announce to your own class sections'));
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId, findByText } = render(<Post />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.changeText(await findByTestId('post-title'), 'T');
  fireEvent.changeText(await findByTestId('post-body'), 'B');
  fireEvent.press(await findByTestId('post-submit'));

  expect(await findByText('You can only announce to your own class sections')).toBeTruthy();
});

it('shows an empty state when the teacher has no classes', async () => {
  (api.request as jest.Mock).mockImplementation(mockRequest({ classes: [], mine: [] }));
  const { findByText } = render(<Post />);

  expect(await findByText(/no classes assigned/i)).toBeTruthy();
});

describe('your recent posts', () => {
  it('renders an explicit empty state when the teacher has posted nothing', async () => {
    (api.request as jest.Mock).mockImplementation(mockRequest({ classes: CLASSES, mine: [] }));
    const { findByText } = render(<Post />);

    expect(await findByText("You haven't posted anything yet.")).toBeTruthy();
  });

  it('shows the server error message verbatim when the list fails to load', async () => {
    (api.request as jest.Mock).mockImplementation(
      mockRequest({ classes: CLASSES, mine: new ApiError(500, 'Announcements service is unavailable') }),
    );
    const { findByTestId } = render(<Post />);

    const err = await findByTestId('mine-error');
    expect(err.props.children).toBe('Announcements service is unavailable');
  });

  it('renders each post with its class name (or "Whole school") and body', async () => {
    (api.request as jest.Mock).mockImplementation(
      mockRequest({
        classes: CLASSES,
        mine: [
          ANNOUNCEMENT,
          { ...ANNOUNCEMENT, id: 'ann-2', title: 'School closed', classSectionId: null, className: null },
        ],
      }),
    );
    const { findByTestId } = render(<Post />);

    const row1 = await findByTestId('mine-row-ann-1');
    expect(within(row1).getByText('Reminder')).toBeTruthy();
    expect(within(row1).getByText('Grade 5-B')).toBeTruthy();

    const row2 = await findByTestId('mine-row-ann-2');
    expect(within(row2).getByText('School closed')).toBeTruthy();
    expect(within(row2).getByText('Whole school')).toBeTruthy();
  });

  it('editing a post pre-fills the form, saves via PATCH, and refreshes the list', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
      if (path === '/manage/announcements/mine') return Promise.resolve([ANNOUNCEMENT]);
      if (path === '/manage/announcements/ann-1') return Promise.resolve({ ...ANNOUNCEMENT, title: 'Fixed typo' });
      throw new Error(`unexpected path: ${path}`);
    });
    (api.request as jest.Mock).mockImplementation(request);

    const { findByTestId, findByText } = render(<Post />);
    await findByText('Reminder');

    const callsBefore = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

    fireEvent.press(await findByTestId('edit-ann-1'));

    const titleInput = await findByTestId('edit-title');
    expect(titleInput.props.value).toBe('Reminder');
    fireEvent.changeText(titleInput, 'Fixed typo');
    fireEvent.press(await findByTestId('edit-save'));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/manage/announcements/ann-1', {
        method: 'PATCH',
        body: { title: 'Fixed typo', body: 'Bring your workbook tomorrow.' },
      }),
    );
    expect(await findByTestId('edit-success')).toBeTruthy();

    await waitFor(() => {
      const callsAfter = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it('cancelling an edit discards changes and fires no request', async () => {
    (api.request as jest.Mock).mockImplementation(mockRequest({ classes: CLASSES, mine: [ANNOUNCEMENT] }));
    const { findByTestId, findByText, queryByText } = render(<Post />);
    await findByText('Reminder');

    fireEvent.press(await findByTestId('edit-ann-1'));
    fireEvent.changeText(await findByTestId('edit-title'), 'Discarded');
    fireEvent.press(await findByTestId('edit-cancel'));

    expect(await findByText('Reminder')).toBeTruthy();
    expect(queryByText('Discarded')).toBeNull();
    expect(api.request).not.toHaveBeenCalledWith('/manage/announcements/ann-1', expect.anything());
  });

  it('shows the server message verbatim when an edit is rejected', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
      if (path === '/manage/announcements/mine') return Promise.resolve([ANNOUNCEMENT]);
      if (path === '/manage/announcements/ann-1')
        return Promise.reject(new ApiError(403, 'You can only edit your own announcements'));
      throw new Error(`unexpected path: ${path}`);
    });
    (api.request as jest.Mock).mockImplementation(request);

    const { findByTestId } = render(<Post />);
    await findByTestId('edit-ann-1');

    fireEvent.press(await findByTestId('edit-ann-1'));
    fireEvent.press(await findByTestId('edit-save'));

    const err = await findByTestId('edit-error');
    expect(err.props.children).toBe('You can only edit your own announcements');
  });

  it('deleting a post asks for confirmation before calling DELETE', async () => {
    (api.request as jest.Mock).mockImplementation(mockRequest({ classes: CLASSES, mine: [ANNOUNCEMENT] }));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { findByTestId } = render(<Post />);
    await findByTestId('delete-ann-1');

    fireEvent.press(await findByTestId('delete-ann-1'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this announcement?',
      '"Reminder" will be removed for everyone it was sent to.',
      expect.any(Array),
    );
    expect(api.request).not.toHaveBeenCalledWith('/manage/announcements/ann-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('confirming the delete calls DELETE and refreshes the list', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
      if (path === '/manage/announcements/mine') return Promise.resolve([ANNOUNCEMENT]);
      if (path === '/manage/announcements/ann-1') return Promise.resolve({ ok: true });
      throw new Error(`unexpected path: ${path}`);
    });
    (api.request as jest.Mock).mockImplementation(request);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirm = buttons?.find((b) => b.text === 'Yes, delete');
      confirm?.onPress?.();
    });

    const { findByTestId } = render(<Post />);
    await findByTestId('delete-ann-1');

    const callsBefore = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

    fireEvent.press(await findByTestId('delete-ann-1'));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/manage/announcements/ann-1', { method: 'DELETE' }),
    );
    expect(await findByTestId('delete-success')).toBeTruthy();

    await waitFor(() => {
      const callsAfter = request.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it('shows the server message verbatim when a delete is rejected', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
      if (path === '/manage/announcements/mine') return Promise.resolve([ANNOUNCEMENT]);
      if (path === '/manage/announcements/ann-1')
        return Promise.reject(new ApiError(403, 'You can only delete your own announcements'));
      throw new Error(`unexpected path: ${path}`);
    });
    (api.request as jest.Mock).mockImplementation(request);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirm = buttons?.find((b) => b.text === 'Yes, delete');
      confirm?.onPress?.();
    });

    const { findByTestId } = render(<Post />);
    await findByTestId('delete-ann-1');

    fireEvent.press(await findByTestId('delete-ann-1'));

    const err = await findByTestId('delete-error');
    expect(err.props.children).toBe('You can only delete your own announcements');
  });
});
