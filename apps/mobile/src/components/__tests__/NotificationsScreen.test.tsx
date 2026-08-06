import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NotificationsScreen } from '../NotificationsScreen';
import { api } from '@/lib/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
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
const READ = {
  id: 'n2', kind: 'RESULT', title: 'Result published', body: 'Maths',
  linkType: 'result', linkId: 'e1', readAt: '2026-08-01T09:00:00.000Z', createdAt: '2026-08-01T08:00:00.000Z',
};

function withNotifications(list: unknown[]) {
  request.mockImplementation((path: string) => {
    if (path === '/me/notifications') return Promise.resolve({ notifications: list, unreadCount: list.filter((n) => !(n as { readAt: string | null }).readAt).length });
    return Promise.resolve({ count: 0 }); // the /read POST
  });
}

beforeEach(() => {
  mockPush.mockReset();
  request.mockReset();
});

it('groups unread under "New" and read under "Earlier"', async () => {
  withNotifications([UNREAD, READ]);
  const { getByText, getByTestId } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByText('New')).toBeTruthy());
  expect(getByText('Earlier')).toBeTruthy();
  expect(getByTestId('notification-n1')).toBeTruthy();
  expect(getByTestId('notification-n2')).toBeTruthy();
});

it('shows an all-caught-up empty state when there are none', async () => {
  withNotifications([]);
  const { getByTestId } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByTestId('notifications-empty')).toBeTruthy());
});

it('tapping an unread thread notification marks it read and deep-links (family route)', async () => {
  withNotifications([UNREAD]);
  const { getByTestId } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByTestId('notification-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-n1'));

  expect(request).toHaveBeenCalledWith(
    '/me/notifications/read',
    expect.objectContaining({ method: 'POST', body: { ids: ['n1'] } }),
  );
  expect(mockPush).toHaveBeenCalledWith('/(family)/messages/th-1');
});

it('resolves the SAME thread link to the staff route for a teacher', async () => {
  withNotifications([UNREAD]);
  const { getByTestId } = render(<NotificationsScreen group="(staff)" />);
  await waitFor(() => expect(getByTestId('notification-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-n1'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/messages/th-1');
});

it('"Mark all read" clears every unread row (the New group disappears)', async () => {
  withNotifications([UNREAD, READ]);
  const { getByText, queryByText } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByText('Mark all read')).toBeTruthy());

  fireEvent.press(getByText('Mark all read'));

  expect(request).toHaveBeenCalledWith('/me/notifications/read', expect.objectContaining({ method: 'POST' }));
  await waitFor(() => expect(queryByText('New')).toBeNull());
});

it('the ✕ dismisses just that row — it leaves the screen and /clear gets its id', async () => {
  withNotifications([UNREAD, READ]);
  const { getByTestId, queryByTestId } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByTestId('notification-n1')).toBeTruthy());

  fireEvent.press(getByTestId('notification-dismiss-n1'));

  // Outcome first: the row is gone, its sibling survives.
  await waitFor(() => expect(queryByTestId('notification-n1')).toBeNull());
  expect(getByTestId('notification-n2')).toBeTruthy();
  expect(request).toHaveBeenCalledWith(
    '/me/notifications/clear',
    expect.objectContaining({ method: 'POST', body: { ids: ['n1'] } }),
  );
  // Dismiss must never also deep-link.
  expect(mockPush).not.toHaveBeenCalled();
});

it('"Clear all" empties the list into the caught-up state', async () => {
  withNotifications([UNREAD, READ]);
  const { getByTestId, queryByTestId } = render(<NotificationsScreen group="(family)" />);
  await waitFor(() => expect(getByTestId('notifications-clear-all')).toBeTruthy());

  fireEvent.press(getByTestId('notifications-clear-all'));

  await waitFor(() => expect(getByTestId('notifications-empty')).toBeTruthy());
  expect(queryByTestId('notification-n1')).toBeNull();
  expect(queryByTestId('notifications-clear-all')).toBeNull();
  expect(request).toHaveBeenCalledWith(
    '/me/notifications/clear',
    expect.objectContaining({ method: 'POST', body: {} }),
  );
});
