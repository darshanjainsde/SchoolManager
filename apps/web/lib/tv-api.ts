import type { TvScreen } from '@skoolos/types';

/**
 * Server-to-server fetch for the TV loop — same base/host discipline as
 * `fetchPublicSite`, same silent-null on any failure: a lobby screen shows
 * "not found", never a stack trace.
 */
export async function fetchTvScreen(host: string, key: string): Promise<TvScreen | null> {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/public/tv?key=${encodeURIComponent(key)}`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as TvScreen;
  } catch {
    return null;
  }
}
