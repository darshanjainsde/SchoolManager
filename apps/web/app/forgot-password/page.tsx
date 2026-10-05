import type { Metadata } from 'next';
import { cache } from 'react';
import { getRequestHost } from '@/lib/request';
import { fetchPublicSite } from '@/lib/public-api';
import { isSchoolHost } from '@/lib/hosts';
import { fontVars } from '@/lib/fonts';
import { resolveLoginTheme } from '../login/gatehouse-theme';
import GatehouseForgot from './GatehouseForgot';
import '../login/login.css';

/**
 * Forgot password — same gatehouse as /login and /reset-password. The theme is
 * resolved on the server from the host, exactly like those two, so the page
 * arrives already wearing the school's identity with no colour flash.
 */
const getSite = cache(fetchPublicSite);

async function forgotTheme() {
  const host = await getRequestHost();
  const data = isSchoolHost(host) ? await getSite(host) : null;
  return resolveLoginTheme(data, host);
}

export async function generateMetadata(): Promise<Metadata> {
  const theme = await forgotTheme();
  return { title: `Reset password · ${theme.schoolName}` };
}

export default async function ForgotPasswordPage() {
  const theme = await forgotTheme();
  return (
    <div className={fontVars}>
      <GatehouseForgot theme={theme} />
    </div>
  );
}
