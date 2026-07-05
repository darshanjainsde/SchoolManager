/**
 * Central host configuration. The platform (owner) console and the tenant
 * (school) sites are distinguished purely by hostname, and these two values
 * are the ONLY place the deployment's domain is named — everything else
 * derives from them. Moving from finokaft.com → mysckool.com is therefore a
 * change of two env vars plus DNS, with zero code edits.
 *
 * Set in production via Vercel env. NEXT_PUBLIC_* is inlined at build time,
 * so these must be present when the web app is built. The localhost fallbacks
 * keep local dev (localhost / owner.localhost) working unchanged.
 */
export const PLATFORM_HOST = (process.env.NEXT_PUBLIC_PLATFORM_HOST ?? 'localhost').toLowerCase();
export const OWNER_HOST = (process.env.NEXT_PUBLIC_PLATFORM_OWNER_HOST ?? 'owner.localhost').toLowerCase();

/** Whether we're running against a local (`*.localhost`) deployment. */
export const IS_LOCAL = PLATFORM_HOST === 'localhost' || PLATFORM_HOST.endsWith('.localhost');

function bareHost(host: string): string {
  return host.split(':')[0].toLowerCase();
}

/** True on the platform apex or the owner console host (no tenant context). */
export function isPlatformHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = bareHost(host);
  return h === PLATFORM_HOST || h === OWNER_HOST;
}

/** True on a school (tenant) host — anything that is not a platform host. */
export function isSchoolHost(host: string | undefined): boolean {
  if (!host) return false;
  return !isPlatformHost(host);
}

/** Example school address shown in "open at your school's address" hints. */
export function exampleSchoolHost(): string {
  return IS_LOCAL ? 'beacon.localhost:3000' : `beacon.${PLATFORM_HOST}`;
}

/** Absolute URL of the platform apex (the school directory / launcher). */
export function platformHref(): string {
  return IS_LOCAL ? 'http://localhost:3000' : `https://${PLATFORM_HOST}`;
}

/** Absolute URL to the owner console (optionally a sub-path). */
export function ownerHref(path = ''): string {
  const base = IS_LOCAL ? 'http://owner.localhost:3000' : `https://${OWNER_HOST}`;
  return base + path;
}

/**
 * Absolute URL to a school (tenant) host, optionally with a sub-path. Adds the
 * dev `:3000` port and uses http locally; uses https with no port in prod.
 */
export function schoolHref(host: string, path = ''): string {
  if (IS_LOCAL) {
    const h = host.includes(':') ? host : `${host}:3000`;
    return `http://${h}${path}`;
  }
  return `https://${host.split(':')[0]}${path}`;
}
