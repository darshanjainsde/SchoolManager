import type { Metadata } from 'next';
import { cache } from 'react';
import { getRequestHost } from '@/lib/request';
import { fetchPublicSite } from '@/lib/public-api';
import { isSchoolHost } from '@/lib/hosts';
import { fontVars } from '@/lib/fonts';
import { resolveLoginTheme } from './gatehouse-theme';
import GatehouseLogin from './GatehouseLogin';
import './login.css';

/**
 * Tenant login — the school's front gate. The server resolves the tenant's
 * public branding (name, logo, colors, heading font) from the request host and
 * paints it into CSS variables before hydration, so the page arrives already
 * wearing the school's identity: no color flash, nothing client-only in the
 * themed render. Platform hosts (sckools.com itself) get the Sckools fallback.
 *
 * All auth behavior lives in GatehouseLogin and is unchanged from the previous
 * page: the role selector is presentational, the API's role decides routing.
 */
const getSite = cache(fetchPublicSite);

async function loginTheme() {
  const host = await getRequestHost();
  const data = isSchoolHost(host) ? await getSite(host) : null;
  return resolveLoginTheme(data, host);
}

export async function generateMetadata(): Promise<Metadata> {
  const theme = await loginTheme();
  return { title: `Sign in · ${theme.schoolName}` };
}

export default async function TenantLoginPage() {
  const theme = await loginTheme();
  return (
    <div className={fontVars}>
      <GatehouseLogin theme={theme} />
    </div>
  );
}
