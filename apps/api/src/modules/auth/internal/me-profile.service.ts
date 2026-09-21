import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';

/**
 * What reaches a person on WhatsApp — one switch per admin moment. Missing
 * means ON: a school that never opened the page still gets every request.
 */
export const NOTIFY_PREF_KEYS = ['leave', 'register', 'fees', 'enquiry', 'summary'] as const;
export type NotifyPrefKey = (typeof NOTIFY_PREF_KEYS)[number];
export type NotifyPrefs = Partial<Record<NotifyPrefKey, boolean>>;

export interface MeProfile {
  userId: string;
  role: string;
  email: string;
  /** The name on the login itself — an admin's only name; a teacher's record name wins in the header. */
  name: string | null;
  notifyPrefs: Record<NotifyPrefKey, boolean>;
}

export function effectivePrefs(raw: unknown): Record<NotifyPrefKey, boolean> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as NotifyPrefs;
  return Object.fromEntries(NOTIFY_PREF_KEYS.map((k) => [k, p[k] !== false])) as Record<NotifyPrefKey, boolean>;
}

/** The one place a login's own row is read and written by its owner (design §5, /me/profile). */
@Injectable()
export class MeProfileService {
  async get(schoolId: string, userId: string): Promise<MeProfile> {
    const db = getPlatformPrisma();
    const u = await db.user.findFirst({ where: { id: userId, schoolId }, select: { id: true, role: true, email: true, name: true, notifyPrefs: true } });
    if (!u) throw new ApiError('NOT_FOUND', 'No such login.', 404);
    return { userId: u.id, role: u.role, email: u.email, name: u.name, notifyPrefs: effectivePrefs(u.notifyPrefs) };
  }

  async update(schoolId: string, userId: string, patch: { name?: string; notifyPrefs?: NotifyPrefs }): Promise<MeProfile> {
    const db = getPlatformPrisma();
    const data: { name?: string | null; notifyPrefs?: NotifyPrefs } = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim().replace(/\s+/g, ' ');
      if (name.length > 80) throw new ApiError('VALIDATION', 'Keep the name under 80 characters.', 400, 'name');
      data.name = name || null;
    }
    if (patch.notifyPrefs !== undefined) {
      const current = await db.user.findFirst({ where: { id: userId, schoolId }, select: { notifyPrefs: true } });
      const merged: NotifyPrefs = { ...effectivePrefs(current?.notifyPrefs) };
      for (const k of NOTIFY_PREF_KEYS) if (typeof patch.notifyPrefs[k] === 'boolean') merged[k] = patch.notifyPrefs[k];
      data.notifyPrefs = merged;
    }
    const r = await db.user.updateMany({ where: { id: userId, schoolId }, data });
    if (r.count === 0) throw new ApiError('NOT_FOUND', 'No such login.', 404);
    return this.get(schoolId, userId);
  }
}
