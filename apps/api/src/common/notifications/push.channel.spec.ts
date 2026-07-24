import { PushChannel } from './push.channel';
import type { AbsenceNoticePayload } from './notification.types';

/**
 * `chunkPushNotifications` here just wraps the whole batch as one chunk —
 * good enough to exercise the loop without needing >100 fake tokens — and
 * `sendPushNotificationsAsync` is the one call every test drives via `send`.
 * `isExpoPushToken` mirrors the real SDK's prefix check closely enough to
 * exercise `PushChannel`'s own filtering.
 */
const send = jest.fn();
jest.mock('expo-server-sdk', () => ({
  Expo: Object.assign(
    jest.fn().mockImplementation(() => ({
      chunkPushNotifications: (msgs: unknown[]) => [msgs],
      sendPushNotificationsAsync: send,
    })),
    { isExpoPushToken: (t: string) => typeof t === 'string' && t.startsWith('ExponentPushToken') },
  ),
}));

/**
 * Only the two `pushToken` methods `PushChannel` actually calls — mirrors
 * `email.channel.spec.ts`'s style of a hand-built double rather than a real
 * Prisma client, since the channel's Prisma dependency is typed structurally.
 */
const prisma = {
  pushToken: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const ABSENCE_NOTICE: AbsenceNoticePayload = {
  schoolName: 'Raffles Intl',
  studentName: 'Aarav Sharma',
  date: 'Fri, 24 Jul 2026',
};

function harness(): PushChannel {
  return new PushChannel(prisma as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PushChannel', () => {
  it('sends to every registered token for the email and reports true', async () => {
    prisma.pushToken.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ]);
    send.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }]);

    const channel = harness();
    const ok = await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    expect(ok).toBe(true);
    expect(prisma.pushToken.findMany).toHaveBeenCalledWith({
      where: { email: 'parent@x.com' },
      select: { token: true },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [sentMessages] = send.mock.calls[0];
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      title: 'Absence notice: Aarav Sharma',
    });
    expect(sentMessages[0].body).not.toContain('undefined');
  });

  it('returns false (not throws) when no tokens exist for the email', async () => {
    prisma.pushToken.findMany.mockResolvedValue([]);

    const channel = harness();
    const ok = await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('prunes DeviceNotRegistered tokens after a failed delivery', async () => {
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[dead]' }]);
    send.mockResolvedValue([
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
    ]);

    const channel = harness();
    const ok = await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    expect(ok).toBe(false);
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[dead]'] } },
    });
  });

  it('reports true if at least one ticket in a mixed batch succeeds', async () => {
    prisma.pushToken.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[live]' },
      { token: 'ExponentPushToken[dead]' },
    ]);
    send.mockResolvedValue([
      { status: 'ok' },
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
    ]);

    const channel = harness();
    const ok = await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    expect(ok).toBe(true);
    expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[dead]'] } },
    });
  });

  it('filters out rows whose stored token is not a valid Expo push token', async () => {
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'not-an-expo-token' }]);

    const channel = harness();
    const ok = await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws when the SDK call itself rejects — reports false instead', async () => {
    prisma.pushToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }]);
    send.mockRejectedValue(new Error('network down'));

    const channel = harness();
    await expect(
      channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE }),
    ).resolves.toBe(false);
  });
});
