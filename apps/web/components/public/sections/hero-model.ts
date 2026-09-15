import type { PublicSiteData } from '@/lib/public-api';

/**
 * How a hero resolves — the pure part, with no client boundary on it.
 *
 * These four used to live in HeroSection.tsx. That file is `'use client'`, and
 * in the RSC graph EVERY export of a client module becomes a client reference —
 * not just the component. So once PublicSite became a server component, calling
 * `heroIsPhotoLayout(data)` from it threw at runtime:
 *
 *   Attempted to call heroIsPhotoLayout() from the server but
 *   heroIsPhotoLayout is on the client.
 *
 * It broke every school site on staging, and nothing local caught it: tsc is
 * happy (the types are fine), and a renderToStaticMarkup harness has no
 * server/client boundary to violate. Only a real Next build has one.
 *
 * A module with no `'use client'` can be imported from either side, which is
 * what these need to be.
 */

/** Layouts that put text on top of a photo and therefore need images + overlay. */
export const PHOTO_LAYOUTS = new Set([
  'FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'COLLAGE', 'SLIDESHOW',
]);

/** Ordered hero images; falls back to the legacy single heroUrl. */
export function heroImagesOf(data: PublicSiteData): string[] {
  const imgs = data.homepage?.heroImages;
  if (imgs && imgs.length > 0) return imgs;
  return data.homepage?.heroUrl ? [data.homepage.heroUrl] : [];
}

/** Whether the school asked for a background video AND gave a usable URL. */
export function heroWantsVideo(data: PublicSiteData): boolean {
  return (
    data.profile?.heroMedia === 'VIDEO' &&
    typeof data.profile?.heroVideoUrl === 'string' &&
    /^https?:\/\//i.test(data.profile.heroVideoUrl)
  );
}

/**
 * Effective layout after fallbacks: old API payloads map through the legacy
 * heroStyle; photo layouts without a single image degrade to the illustrated
 * hero (same downgrade the old PHOTO style had); a one-image slideshow is
 * just a full-bleed.
 */
export function resolveHeroLayout(data: PublicSiteData): string {
  const p = data.profile;
  const declared =
    p?.heroLayout ?? (p?.heroStyle === 'PHOTO' ? 'FULL_BLEED' : (p?.heroStyle ?? 'ILLUSTRATION'));
  const count = heroImagesOf(data).length;
  // A background video stands in for the missing photo: the media IS the
  // full-bleed backdrop, so the no-image downgrade must not fire — but ONLY
  // for a video that can actually render (a real http(s) URL). A half-typed
  // URL must still degrade to the illustrated hero, never a blank band.
  if (PHOTO_LAYOUTS.has(declared) && count === 0) {
    return heroWantsVideo(data) ? 'FULL_BLEED' : 'ILLUSTRATION';
  }
  if (declared === 'SLIDESHOW' && count === 1) return 'FULL_BLEED';
  return declared;
}

/** Whether the effective layout is photo-based (drives the GHOST navbar). */
export function heroIsPhotoLayout(data: PublicSiteData): boolean {
  return PHOTO_LAYOUTS.has(resolveHeroLayout(data));
}
