import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NotificationSlip } from '../NotificationSlip';
import { api } from '@/lib/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const request = api.request as jest.Mock;

const UNREAD = {
  id: 'n1', kind: 'MESSAGE', title: 'New message from Ms Rao', body: 'Hi',
  linkType: 'thread', linkId: 'th-1', readAt: null, createdAt: '2026-08-01T10:00:00.000Z',
};
const REMARK = {
  id: 'n3', kind: 'DIARY', title: 'A remark needs a signature', body: null,
  linkType: null, linkId: null, readAt: null, createdAt: '2026-08-01T11:00:00.000Z',
};
const READ = {
  id: 'n2', kind: 'RESULT', title: 'Result published', body: 'Maths',
  linkType: 'result', linkId: 'e1', readAt: '2026-08-01T09:00:00.000Z', createdAt: '2026-08-01T08:00:00.000Z',
};

function withNotifications(list: unknown[]) {
  request.mockImplementation((path: string) => {
    if (path === '/me/notifications') {
      return Promise.resolve({
        notifications: list,
        unreadCount: list.filter((n) => !(n as { readAt: string | null }).readAt).length,
      });
    }
    return Promise.resolve({ count: 0 }); // the /read POST
  });
}

beforeEach(() => {
  mockPush.mockReset();
  request.mockReset();
});

it('is not rendered at all while closed — the bell owns whether it exists', () => {
  withNotifications([UNREAD]);
  const { queryByTestId } = render(
    <NotificationSlip group="(family)" visible={false} onClose={jest.fn()} />,
  );
  expect(queryByTestId('notification-slip')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('groups unread under New and read under Earlier', async () => {
  withNotifications([UNREAD, READ]);
  const { getByText, getByTestId } = render(
    <NotificationSlip group="(family)" visible onClose={jest.fn()} />,
  );
  await waitFor(() => expect(getByText('New')).toBeTruthy());
  expect(getByText('Earlier')).toBeTruthy();
  expect(getByTestId('notification-slip-n1')).toBeTruthy();
  expect(getByTestId('notification-slip-n2')).toBeTruthy();
});

it('tapping an unread row marks it read, closes the slip and deep-links (family route)', async () => {
  withNotifications([UNREAD]);
  const onClose = jest.fn();
  const { getByTestId } = render(<NotificationSlip group="(family)" visible onClose={onClose} />);
  await waitFor(() => expect(getByTestId('notification-slip-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-slip-n1'));

  expect(request).toHaveBeenCalledWith(
    '/me/notifications/read',
    expect.objectContaining({ method: 'POST', body: { ids: ['n1'] } }),
  );
  expect(onClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/(family)/messages/th-1');
});

it('resolves the SAME thread link to the staff route for a teacher', async () => {
  withNotifications([UNREAD]);
  const { getByTestId } = render(<NotificationSlip group="(staff)" visible onClose={jest.fn()} />);
  await waitFor(() => expect(getByTestId('notification-slip-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-slip-n1'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/messages/th-1');
});

it('reports the remaining unread count so the bell can count down', async () => {
  withNotifications([UNREAD, REMARK]);
  const onUnreadChange = jest.fn();
  const { getByTestId } = render(
    <NotificationSlip group="(family)" visible onClose={jest.fn()} onUnreadChange={onUnreadChange} />,
  );
  await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(2));

  fireEvent.press(getByTestId('notification-slip-n1'));
  expect(onUnreadChange).toHaveBeenLastCalledWith(1);
});

it('"Mark all read" clears every unread row and silences the badge', async () => {
  withNotifications([UNREAD, READ]);
  const onUnreadChange = jest.fn();
  const { getByTestId, queryByText } = render(
    <NotificationSlip group="(family)" visible onClose={jest.fn()} onUnreadChange={onUnreadChange} />,
  );
  await waitFor(() => expect(getByTestId('notification-slip-mark-all')).toBeTruthy());

  fireEvent.press(getByTestId('notification-slip-mark-all'));

  expect(request).toHaveBeenCalledWith('/me/notifications/read', expect.objectContaining({ method: 'POST' }));
  expect(onUnreadChange).toHaveBeenLastCalledWith(0);
  await waitFor(() => expect(queryByText('New')).toBeNull());
});

it('tapping the scrim closes it without marking anything read', async () => {
  withNotifications([UNREAD]);
  const onClose = jest.fn();
  const { getByTestId } = render(<NotificationSlip group="(family)" visible onClose={onClose} />);
  await waitFor(() => expect(getByTestId('notification-slip-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-slip-scrim'));

  expect(onClose).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalledWith('/me/notifications/read', expect.anything());
});

// The slip is an ADDITIONAL surface, not a replacement: the full-page
// notification centre is still a registered route in both portals, and this is
// the link that keeps it reachable from the bell.
it('"See all notifications" opens the standalone notification screen', async () => {
  withNotifications([UNREAD]);
  const onClose = jest.fn();
  const { getByTestId } = render(<NotificationSlip group="(staff)" visible onClose={onClose} />);
  await waitFor(() => expect(getByTestId('notification-slip-see-all')).toBeTruthy());

  fireEvent.press(getByTestId('notification-slip-see-all'));

  expect(onClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/(staff)/notifications');
});

it('shows an all-caught-up empty state, and no "See all" to a page with nothing on it', async () => {
  withNotifications([]);
  const { getByTestId, queryByTestId } = render(
    <NotificationSlip group="(family)" visible onClose={jest.fn()} />,
  );
  await waitFor(() => expect(getByTestId('notification-slip-empty')).toBeTruthy());
  expect(queryByTestId('notification-slip-see-all')).toBeNull();
});

it('shows the API error message verbatim when the list fails to load', async () => {
  const { ApiError } = jest.requireActual('@/lib/api');
  request.mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { getByTestId } = render(<NotificationSlip group="(family)" visible onClose={jest.fn()} />);

  await waitFor(() =>
    expect(getByTestId('notification-slip-error').props.children).toBe('Could not reach the school server.'),
  );
});
