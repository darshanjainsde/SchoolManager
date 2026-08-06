const txMock = {
  notification: {
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
// Spread the real module so re-exported Prisma enums (UserRole, …) survive —
// NotificationsService injects TenantContextService from '../tenancy', whose
// barrel pulls users.controller's @Roles(UserRole.SCHOOL_ADMIN) at import time.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { NotificationsService } from './notifications.service';
import type { TenantContextService } from '../tenancy';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-1';

function makeSvc() {
  const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as unknown as TenantContextService;
  return new NotificationsService(tenant);
}

describe('NotificationsService', () => {
  const svc = makeSvc();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.notification.findMany.mockResolvedValue([]);
    txMock.notification.count.mockResolvedValue(0);
    txMock.notification.updateMany.mockResolvedValue({ count: 0 });
  });

  it('lists newest-first, maps ISO dates, and returns the exact unread count', async () => {
    txMock.notification.findMany.mockResolvedValue([
      {
        id: 'n1', kind: 'MESSAGE', title: 'New message from Ms. Iyer', body: 'Hi',
        linkType: 'thread', linkId: 't1', readAt: null, createdAt: new Date('2026-08-01T10:00:00Z'),
      },
      {
        id: 'n2', kind: 'RESULT', title: 'Result published', body: null,
        linkType: 'result', linkId: 'e1', readAt: new Date('2026-08-01T09:00:00Z'), createdAt: new Date('2026-08-01T08:00:00Z'),
      },
    ]);
    txMock.notification.count.mockResolvedValue(1);

    const out = await svc.list(USER);

    expect(out.unreadCount).toBe(1);
    expect(out.notifications).toHaveLength(2);
    expect(out.notifications[0]).toMatchObject({ id: 'n1', kind: 'MESSAGE', readAt: null });
    expect(out.notifications[0].createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(out.notifications[1].readAt).toBe('2026-08-01T09:00:00.000Z');
    // Scoped to the caller's own userId — never another user's rows.
    expect(txMock.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, clearedAt: null }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('returns just the unread count for the bell', async () => {
    txMock.notification.count.mockResolvedValue(4);
    const out = await svc.unreadCount(USER);
    expect(out.count).toBe(4);
    expect(txMock.notification.count).toHaveBeenCalledWith({
      where: { userId: USER, readAt: null, clearedAt: null },
    });
  });

  it('mark-all-read updates only the caller unread rows and returns the remaining count', async () => {
    txMock.notification.count.mockResolvedValue(0);
    const out = await svc.markRead(USER);
    expect(out.count).toBe(0);
    expect(txMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, readAt: null, clearedAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('mark-read with ids scopes to those ids AND the caller', async () => {
    await svc.markRead(USER, ['id-1', 'id-2']);
    expect(txMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, readAt: null, clearedAt: null, id: { in: ['id-1', 'id-2'] } },
      data: { readAt: expect.any(Date) },
    });
  });

  it('mark-read with an empty id list is treated as mark-all (no id filter)', async () => {
    await svc.markRead(USER, []);
    expect(txMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, readAt: null, clearedAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('clear-all stamps readAt on unread rows, clearedAt on every row, and returns the remaining count', async () => {
    txMock.notification.count.mockResolvedValue(0);
    const out = await svc.clear(USER);
    expect(out.count).toBe(0);
    // First pass: reading the still-unread rows (a dismissed unread row must
    // not keep inflating the badge)…
    expect(txMock.notification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: USER, clearedAt: null, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    // …second pass: clearing every still-visible row.
    expect(txMock.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: USER, clearedAt: null },
      data: { clearedAt: expect.any(Date) },
    });
  });

  it('clear with ids (the per-row ✕) scopes both passes to those ids AND the caller', async () => {
    await svc.clear(USER, ['id-9']);
    expect(txMock.notification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: USER, clearedAt: null, readAt: null, id: { in: ['id-9'] } },
      data: { readAt: expect.any(Date) },
    });
    expect(txMock.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: USER, clearedAt: null, id: { in: ['id-9'] } },
      data: { clearedAt: expect.any(Date) },
    });
  });

  it('rejects an unknown persisted kind rather than returning a malformed row', async () => {
    txMock.notification.findMany.mockResolvedValue([
      { id: 'x', kind: 'BOGUS', title: 't', body: null, linkType: null, linkId: null, readAt: null, createdAt: new Date() },
    ]);
    await expect(svc.list(USER)).rejects.toThrow(/Invalid Notification kind/);
  });
});
