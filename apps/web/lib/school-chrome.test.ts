import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ONE RULE: if the address is the school's, the tab is the school's.
 *
 * Eleven routes served on a school host — its console, its portals, its blog,
 * its careers page, its invite and reset pages — all wore the Sckools mark
 * and the word "Sckools", measured on production 2026-09-30. A head teacher
 * with five tabs open saw five identical icons of OUR product on THEIR
 * addresses.
 *
 * The fallback is deliberate and is the other half of the rule: a school with
 * no logo yet returns no `icons` at all, which lets the platform mark win by
 * Next's file convention. Better our mark than a broken image.
 */
const host = vi.fn();
const site = vi.fn();
vi.mock('@/lib/request', () => ({ getRequestHost: () => host() }));
vi.mock('@/lib/public-api', () => ({ fetchPublicSite: () => site() }));

import { schoolChrome, schoolIcon, schoolIconMetadata } from './school-metadata';

const SCHOOL = {
  school: { name: 'Raffles Primary School' },
  profile: { logoUrl: 'https://cdn/logo.png', faviconUrl: null },
};

beforeEach(() => { vi.clearAllMocks(); });

describe('schoolChrome', () => {
  it('gives a school host the school’s name and its own mark', async () => {
    host.mockResolvedValue('raffles.sckools.com');
    site.mockResolvedValue(SCHOOL);
    expect(await schoolChrome('Console')).toEqual({
      title: 'Console · Raffles Primary School',
      icons: { icon: 'https://cdn/logo.png', shortcut: 'https://cdn/logo.png', apple: 'https://cdn/logo.png' },
    });
  });

  // `PLATFORM_HOST` comes from NEXT_PUBLIC_PLATFORM_HOST and falls back to
  // `localhost`, which is what it is here — so this asserts the real rule
  // rather than a mocked one. In production the same branch is sckools.com.
  it('leaves a PLATFORM host alone, so the platform keeps the Tassel-S', async () => {
    host.mockResolvedValue('localhost');
    expect(await schoolChrome('Console')).toEqual({});
    expect(site).not.toHaveBeenCalled();
  });

  it('prefers a school’s favicon over its logo when it has uploaded one', () => {
    expect(schoolIcon({ faviconUrl: 'https://cdn/fav.ico', logoUrl: 'https://cdn/logo.png' })).toBe('https://cdn/fav.ico');
  });

  it('falls back to our mark when the school has no logo at all', async () => {
    host.mockResolvedValue('newschool.sckools.com');
    site.mockResolvedValue({ school: { name: 'New School' }, profile: { logoUrl: null, faviconUrl: null } });
    const m = await schoolChrome('Console');
    // A title, but NO `icons` — that is what lets app/icon.svg win by file
    // convention rather than rendering a broken image.
    expect(m.title).toBe('Console · New School');
    expect(m.icons).toBeUndefined();
    expect(schoolIconMetadata(null)).toEqual({});
  });

  it('says nothing at all for a host that resolves to no school', async () => {
    host.mockResolvedValue('unknown.sckools.com');
    site.mockResolvedValue(null);
    expect(await schoolChrome('Console')).toEqual({});
  });
});
