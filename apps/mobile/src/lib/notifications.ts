import { api } from './api';
import type { NotificationListResult, UnreadCountResult } from '@skoolos/types';

/**
 * Client helpers for the in-app notification bell (both portals). All three hit
 * the role-agnostic `/me/notifications` surface — the server scopes every row to
 * the caller, so the same calls work for a student or a teacher login.
 */

export function fetchNotifications(): Promise<NotificationListResult> {
  return api.request<NotificationListResult>('/me/notifications');
}

export function fetchUnreadCount(): Promise<UnreadCountResult> {
  return api.request<UnreadCountResult>('/me/notifications/unread-count');
}

/** Mark specific notifications read, or (no ids) mark them all read. Returns the
 *  remaining unread total so the caller can update the bell without a refetch. */
export function markNotificationsRead(ids?: string[]): Promise<UnreadCountResult> {
  return api.request<UnreadCountResult>('/me/notifications/read', {
    method: 'POST',
    body: ids && ids.length > 0 ? { ids } : {},
  });
}

/** Soft-clear ("dismiss") specific notifications, or (no ids) clear the lot —
 *  the notification screen's per-row ✕ and its "Clear all". Cleared rows leave
 *  the list and the badge but are never destroyed server-side. */
export function clearNotifications(ids?: string[]): Promise<UnreadCountResult> {
  return api.request<UnreadCountResult>('/me/notifications/clear', {
    method: 'POST',
    body: ids && ids.length > 0 ? { ids } : {},
  });
}
