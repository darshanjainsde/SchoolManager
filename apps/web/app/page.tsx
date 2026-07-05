import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchPublicSite, fetchDirectory } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import PlatformLanding from '@/components/PlatformLanding';
import { isPlatformHost } from '@/lib/hosts';

async function getApiHealth(): Promise<string> {
  const url = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/health';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return `error:${res.status}`;
    const data = (await res.json()) as { status?: string };
    return data.status ?? 'unknown';
  } catch (e) {
    return `unreachable:${(e as Error).message}`;
  }
}

export default async function HomePage() {
  const host = headers().get('host') ?? '';

  if (!isPlatformHost(host)) {
    const data = await fetchPublicSite(host);
    if (data) {
      return <PublicSite data={data} />;
    }
    // A school-style host that resolves to no live site (unknown/suspended/not
    // yet live) must 404 — never fall through to the internal dev launcher,
    // which would leak platform tooling links on a public domain.
    notFound();
  }

  const [apiStatus, schools] = await Promise.all([getApiHealth(), fetchDirectory()]);

  return <PlatformLanding schools={schools} apiHealthy={apiStatus === 'ok'} />;
}
