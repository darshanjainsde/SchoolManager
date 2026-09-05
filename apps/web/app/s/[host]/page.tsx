import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { schoolMetadata } from '@/lib/school-metadata';

/**
 * A school's homepage, addressed by host as a ROUTE rather than a header.
 *
 * The visitor never sees this path. Middleware rewrites raffles.sckools.com/
 * to /s/raffles.sckools.com, and the URL in the address bar is untouched.
 *
 * WHY THE REWRITE EXISTS AT ALL: reading the tenant from `headers()` opts the
 * route into dynamic rendering, and Next serves a dynamic route
 * `private, no-store` — which forbids the CDN and the browser cache alike.
 * That was measured: 22 of 22 public URLs answered `x-vercel-cache: MISS`, and
 * setting Cache-Control from middleware did NOT override it (also measured, on
 * staging — the framework header wins). Putting the host in the path is what
 * makes the response cacheable, and the edge cache key already contains the
 * host, so two schools can never share an entry.
 *
 * `revalidate` rather than `force-static`: the school edits this content, and
 * an hour-stale prospectus is worse than a 60-second one.
 */
export const revalidate = 60;
/** A host we have never rendered still renders on demand, then caches. */
export const dynamicParams = true;

/**
 * Empty on purpose, and NOT optional.
 *
 * Schools are created and renamed at runtime, so there is no build-time list
 * of hosts to prerender — but a dynamic segment with no `generateStaticParams`
 * at all is treated as fully dynamic, and Next then serves it
 * `private, no-store` no matter what `revalidate` says. Returning an empty
 * array is what puts the route in the cacheable family: nothing is built ahead
 * of time, the first visitor to each host pays for the render, and everyone
 * after them is served from the edge until it revalidates.
 *
 * This was measured, not reasoned: without it, raffles.test.sckools.com/
 * answered `no-store` / MISS on every one of three consecutive requests.
 */
export function generateStaticParams(): { host: string }[] {
  return [];
}

type Params = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { host } = await params;
  return schoolMetadata(decodeURIComponent(host));
}

export default async function SchoolHomePage({ params }: Params) {
  const { host } = await params;
  const data = await fetchPublicSite(decodeURIComponent(host));
  // A school-style host that resolves to no live site (unknown, suspended, or
  // not yet published) must 404 — never fall through to a platform page.
  if (!data) notFound();
  return <PublicSite data={data} />;
}
