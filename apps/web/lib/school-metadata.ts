import type { Metadata } from 'next';
import { getRequestHost } from '@/lib/request';
import { isPlatformHost } from '@/lib/hosts';
import { cache } from 'react';
import { fetchPublicSite } from '@/lib/public-api';

/**
 * The <head> for a school's public site.
 *
 * Lifted out of app/page.tsx when the host-routed copy at /s/[host] was added,
 * so the two cannot drift: a school whose title tag depended on which route
 * happened to serve it would be a search-visibility bug nobody would notice
 * for months.
 */
/** One fetch per request even though generateMetadata and the page both need it. */
export const getPublicSite = cache(fetchPublicSite);

/**
 * THE MARK IN THE BROWSER TAB.
 *
 * A school that has uploaded a logo must wear it on every one of its own
 * pages. Without this the root `app/icon.svg` (the Sckools Tassel-S) wins by
 * file convention, so a parent on the school's Programmes page saw the
 * platform's icon and the word "Sckools" in the tab — the school's site
 * advertising us instead of them. Only the homepage set `icons` before.
 *
 * `faviconUrl` first because a school that bothered to upload a favicon meant
 * it; the logo is the fallback, and the platform mark is the last resort
 * (returning no `icons` lets the file convention apply).
 */
export function schoolIcon(profile: { faviconUrl?: string | null; logoUrl?: string | null } | null | undefined): string | null {
  return profile?.faviconUrl ?? profile?.logoUrl ?? null;
}

/** `icons` for a school mark, in the shape Next expects — apple included so an
 *  added-to-home-screen shortcut is the school's too. */
export function schoolIconMetadata(icon: string | null): Pick<Metadata, 'icons'> {
  return icon ? { icons: { icon, shortcut: icon, apple: icon } } : {};
}

/**
 * THE CHROME FOR ANYTHING SERVED ON A SCHOOL'S HOST.
 *
 * One rule, applied everywhere: if the address is the school's, the tab is
 * the school's. Not only its public website — its console, its portals, its
 * careers page, its invite and reset pages. A head teacher with five tabs
 * open was looking at five identical Sckools marks and the word "Sckools"
 * five times; the product they are paying for is supposed to be theirs.
 *
 * A platform host (sckools.com, the owner console) gets `{}` and keeps the
 * Tassel-S by file convention — there the mark IS the right answer.
 *
 * Reading the host makes a route dynamic, which is why this is never used on
 * the cacheable public-site routes under `/s/[host]`: those take the host
 * from the path and call `schoolMetadata`/`schoolPageMetadata` instead.
 */
export async function schoolChrome(page: string | null): Promise<Metadata> {
  const host = await getRequestHost();
  if (isPlatformHost(host)) return {};
  return schoolPageMetadata(host, page);
}

/**
 * The <head> for a school's INNER pages (Programmes, Gallery, Contact…).
 *
 * They had no `generateMetadata` at all, so every one of them inherited the
 * platform title and the platform icon.
 */
export async function schoolPageMetadata(host: string, page: string | null): Promise<Metadata> {
  const data = await getPublicSite(host);
  if (!data) return {};
  const title = page ? `${page} · ${data.school.name}` : data.school.name;
  return { title, ...schoolIconMetadata(schoolIcon(data.profile)) };
}

export async function schoolMetadata(host: string): Promise<Metadata> {
  const data = await getPublicSite(host);
  if (!data) return {};
  const { school, profile, homepage } = data;
  const title = profile?.city ? `${school.name} — ${profile.city}` : school.name;
  const rawDesc =
    homepage?.subheadline ||
    homepage?.aboutText ||
    `${school.name}: admissions, academics, gallery, events and contact details.`;
  const description = rawDesc.replace(/\s+/g, ' ').trim().slice(0, 160);
  const icon = schoolIcon(profile);
  return {
    title,
    description,
    ...schoolIconMetadata(icon),
    openGraph: {
      title,
      description,
      siteName: school.name,
      type: 'website',
      ...(homepage?.heroUrl ? { images: [{ url: homepage.heroUrl }] } : {}),
    },
  };
}

