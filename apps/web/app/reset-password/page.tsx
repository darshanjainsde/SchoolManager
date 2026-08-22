import type { Metadata } from 'next';
import { cache } from 'react';
import { getRequestHost } from '@/lib/request';
import { fetchPublicSite } from '@/lib/public-api';
import { isSchoolHost } from '@/lib/hosts';
import { fontVars } from '@/lib/fonts';
import { resolveLoginTheme } from '../login/gatehouse-theme';
import GatehouseReset from './GatehouseReset';
import '../login/login.css';

/**
 * Set-a-new-password — same gatehouse as /login. The invite email is many a
 * parent's and teacher's FIRST contact with the school's system, and the old
 * bare card here could have belonged to any product. The server resolves the
 * school's branding from the host exactly like the login page, so the link
 * lands somewhere recognisably theirs, with no colour flash.
 */
const getSite = cache(fetchPublicSite);

async function resetTheme() {
  const host = await getRequestHost();
  const data = isSchoolHost(host) ? await getSite(host) : null;
  return resolveLoginTheme(data, host);
}

export async function generateMetadata(): Promise<Metadata> {
  const theme = await resetTheme();
  return { title: `Set a new password · ${theme.schoolName}` };
}

export default async function ResetPasswordPage() {
  const theme = await resetTheme();
  return (
    <div className={fontVars}>
      <GatehouseReset theme={theme} />
    </div>
  );
}
