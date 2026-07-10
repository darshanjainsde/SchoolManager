import type { MetadataRoute } from 'next';

/**
 * The disallowed paths are private consoles on every host (platform and
 * school alike), so one static robots answer is safe for all hosts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/owner', '/platform', '/app', '/login', '/portal', '/teacher', '/me', '/account', '/forgot-password', '/reset-password', '/accept-invite'],
    },
    sitemap: 'https://sckools.com/sitemap.xml',
  };
}
