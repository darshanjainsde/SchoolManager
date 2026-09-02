import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { fetchTvScreen } from '@/lib/tv-api';
import { TvLoop } from './tv-loop';

/**
 * Sckools TV — any television with a browser and this one URL.
 *
 * Server shell: resolve the school from the host, gate on the display key,
 * hand the composed screen to the client loop. Every failure is the same
 * 404 — whether a school runs a TV is not a passer-by's business.
 */
export default async function TvPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();

  const { key } = await searchParams;
  if (!key) notFound();

  const screen = await fetchTvScreen(host, key);
  if (!screen) notFound();

  return <TvLoop initial={screen} tvKey={key} />;
}
