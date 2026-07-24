import { loadEnv } from '@skoolos/config';

/**
 * Hostname to attribute a SCHOOL-scope post to on the global blog: the
 * school's primary domain if it has one, else `<slug>.<platformHost>` — same
 * fallback DirectoryService uses for the platform school directory.
 */
export function schoolHost(school: { slug: string; domains: { hostname: string }[] }): string {
  const env = loadEnv();
  return school.domains[0]?.hostname ?? `${school.slug}.${env.PLATFORM_HOST}`;
}

/** Absolute URL of a post on the platform (global) blog. */
export function platformBlogUrl(slug: string): string {
  const env = loadEnv();
  return `https://${env.PLATFORM_HOST}/blog/${slug}`;
}

/** Absolute URL of a post on its own tenant host (the "self" canonical). */
export function tenantBlogUrl(hostname: string, slug: string): string {
  return `https://${hostname.split(':')[0]}/blog/${slug}`;
}
