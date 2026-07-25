import { headers } from 'next/headers';

/**
 * The incoming request's `Host` header — the single source of truth for
 * which tenant is being rendered on every school-facing page. `headers()`
 * is async in Next 15 but still sync (and freely awaitable) on Next 14, so
 * `await`-ing it here is a harmless pass-through on 14 and forward-compatible
 * with 15 — this is the one place that needs updating when the sync→async
 * switch actually lands upstream.
 *
 * Server-only: kept out of `lib/hosts.ts` because that file's constants
 * (PLATFORM_HOST, isPlatformHost, etc.) are also imported by 'use client'
 * components, and `next/headers` cannot be pulled into a client bundle.
 */
export async function getRequestHost(): Promise<string> {
  return (await headers()).get('host') ?? '';
}
