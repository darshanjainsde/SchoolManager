import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';

/**
 * Load a school's site for a host-routed page, or 404.
 *
 * Shared by every page under app/s/[host] so the fetch, the decode and the
 * "no live site" rule are written once. A school-style host that resolves to
 * nothing — unknown, suspended, or not yet published — must 404 rather than
 * fall through to anything of ours.
 */
export async function loadSchoolSite(hostParam: string) {
  const data = await fetchPublicSite(decodeURIComponent(hostParam));
  if (!data) notFound();
  return data;
}
