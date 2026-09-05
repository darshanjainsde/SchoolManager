/**
 * Route a school-uploaded image through Next's optimiser.
 *
 * School media arrives at whatever size and format the school happened to
 * have: a crest displayed 40px tall in the nav was shipping a 238 KB JPEG, and
 * it was the largest thing on the page. `next/image` fixes that for <img>, but
 * most of this site paints photos as CSS `background-image` — heroes, course
 * covers, event covers — which no component can reach. Both cases can use the
 * optimiser's own endpoint, which is all `next/image` does underneath.
 *
 * Falls back to the original URL whenever the host is not one we registered in
 * `next.config.mjs`. That is not defensive padding: storage differs per
 * environment (Supabase in staging and production, MinIO locally), and asking
 * the optimiser for an unregistered host is a runtime error, so an unguarded
 * call would turn every local development image into a broken one.
 */

/** Must stay in step with `images.remotePatterns` in next.config.mjs. */
const OPTIMISABLE_HOST = /(^|\.)supabase\.co$/i;

/**
 * Next only serves widths it was configured for and answers 400 for anything
 * else, so a requested width is snapped up to the nearest allowed one rather
 * than passed through. These are Next's defaults (imageSizes + deviceSizes).
 */
const ALLOWED_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
];

export function isOptimisable(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && OPTIMISABLE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function snapWidth(width: number): number {
  return ALLOWED_WIDTHS.find((w) => w >= width) ?? ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];
}

/**
 * `width` is the widest CSS pixel width the image is ever painted at; ask for
 * roughly twice that so it still looks right on a dense screen.
 */
export function optimised(url: string, width: number, quality = 75): string {
  if (!isOptimisable(url)) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${snapWidth(width)}&q=${quality}`;
}
