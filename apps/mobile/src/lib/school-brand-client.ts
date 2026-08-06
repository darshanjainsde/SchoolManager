import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { session } from './session';

/**
 * The school's own colours, for the light theme.
 *
 * No new endpoint and no new column: the app already stores `schoolHost`, and
 * `GET /public/site` — the same unauthenticated call the school's website
 * makes — already returns the brand colours. Reading them here means the app
 * and the website can never disagree about what a school's colour is, because
 * there is only one place it is set.
 *
 * Cached, and read from cache FIRST: the theme must be right on the frame the
 * app opens, not one network round-trip later. A school that changes its
 * colour sees it on the next launch, which is the correct trade for never
 * flashing the wrong palette at somebody.
 */
const CACHE_KEY = 'sckools.schoolBrand';

export interface SchoolBrand {
  primary: string;
  secondary: string;
}

function base(): string {
  return (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:4000';
}

export async function readCachedBrand(): Promise<SchoolBrand | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    return raw ? (JSON.parse(raw) as SchoolBrand) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and cache. Every failure path returns null and leaves the cached value
 * alone — a school on a bad connection keeps the colours it had rather than
 * snapping back to indigo mid-session.
 */
export async function refreshSchoolBrand(): Promise<SchoolBrand | null> {
  try {
    const host = await session.getSchoolHost();
    if (!host) return null;
    const res = await fetch(`${base()}/public/site`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { profile?: { brandColorPrimary?: string; brandColorSecondary?: string } };
    const primary = body.profile?.brandColorPrimary;
    if (!primary) return null;
    const brand: SchoolBrand = { primary, secondary: body.profile?.brandColorSecondary ?? primary };
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(brand)).catch(() => undefined);
    return brand;
  } catch {
    return null;
  }
}

/** Signing out forgets the school's colours with everything else. */
export async function clearSchoolBrand(): Promise<void> {
  await SecureStore.deleteItemAsync(CACHE_KEY).catch(() => undefined);
}
