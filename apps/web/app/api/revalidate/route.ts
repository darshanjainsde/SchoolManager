import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Drop a school's cached pages the moment it publishes.
 *
 * School pages are cached for 60 seconds so a view does not re-run eleven
 * database queries. That 60s is the only freshness cost the caching work
 * introduced, and it is the wrong cost to leave in place: a head teacher who
 * fixes a wrong phone number and reloads should see the fix, not a stale page
 * that makes them think the save failed and press it again.
 *
 * Every cached page carries a `site:<host>` tag, so this purges exactly one
 * school's pages and touches no other tenant's.
 *
 * Guarded by a shared secret rather than left open: revalidation is cheap to
 * ask for and expensive to serve, so an unauthenticated endpoint is a free way
 * to make us re-render every school on demand.
 */
export const runtime = 'nodejs';
/** Never cache the purge endpoint itself. */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    // Unset means the purge path is not wired for this deployment. Say so
    // plainly rather than silently accepting and doing nothing.
    return NextResponse.json({ error: 'revalidation is not configured' }, { status: 503 });
  }
  if (req.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let hosts: unknown;
  try {
    hosts = (await req.json())?.hosts;
  } catch {
    return NextResponse.json({ error: 'expected {"hosts": ["…"]}' }, { status: 400 });
  }
  if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string')) {
    return NextResponse.json({ error: 'expected {"hosts": ["…"]}' }, { status: 400 });
  }

  const purged: string[] = [];
  for (const host of hosts as string[]) {
    const h = host.trim().toLowerCase();
    if (!h) continue;
    revalidateTag(`site:${h}`);
    purged.push(h);
  }
  return NextResponse.json({ purged });
}
