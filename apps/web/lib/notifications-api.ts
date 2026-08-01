'use client';
import type { ApiClient } from './api';
import type { NotificationListResult, UnreadCountResult } from '@skoolos/types';

/**
 * The per-user notification inbox behind the bell in both portals. These wrap
 * the same `ApiClient` every portal page already uses (see `useApi`), so tenant
 * host headers and 401-refresh come for free — this module only names the three
 * endpoints so a page never hand-types the paths.
 *
 * The endpoints are role-agnostic: the server scopes rows to the caller, so a
 * logged-in STUDENT and a TEACHER hit exactly these same URLs.
 */

/** `GET /me/notifications` — newest first, plus the unread total for the bell. */
export function fetchNotifications(api: ApiClient): Promise<NotificationListResult> {
  return api.get<NotificationListResult>('/me/notifications');
}

/** `GET /me/notifications/unread-count` — the cheap badge poll for the bell. */
export function fetchUnreadCount(api: ApiClient): Promise<UnreadCountResult> {
  return api.get<UnreadCountResult>('/me/notifications/unread-count');
}

/**
 * `POST /me/notifications/read`. No ids (or an empty list) marks EVERYTHING
 * read; a non-empty `ids` marks just those. Returns how many rows flipped.
 */
export function markNotificationsRead(
  api: ApiClient,
  ids?: string[],
): Promise<{ count: number }> {
  return api.post<{ count: number }>(
    '/me/notifications/read',
    ids && ids.length > 0 ? { ids } : {},
  );
}
