import { NextResponse, type NextRequest } from 'next/server';

/**
 * CSP for the authenticated consoles — the routes that hold a session and PII.
 * Public pages keep the lighter baseline from next.config.mjs so they stay
 * CDN-cacheable (Scale checkpoint 4).
 *
 * On `script-src 'self' 'unsafe-inline'` rather than nonce + strict-dynamic:
 * the console shells are statically prerendered (they render `null` until the
 * client knows whether you are signed in), and a per-request nonce cannot be
 * baked into build-time HTML — Next serves those pages with un-nonced script
 * tags, `strict-dynamic` refuses them, and every console renders as dead HTML.
 * That was verified in a browser, not assumed: __next_f was missing and React
 * never hydrated. A hash cannot cover Next's inline flight payloads either,
 * since their contents differ per page.
 *
 * So this policy does NOT stop inline-script injection. What it does stop is
 * everything that made an XSS *useful*: loading script from any other origin,
 * exfiltrating to any host outside connect-src, <object>/<embed>, <base>
 * hijacking, and posting forms off-origin. Upgrading to a true strict CSP
 * means forcing the console routes to render dynamically — tracked as a
 * follow-up rather than pretended-at here.
 */
export function middleware(req: NextRequest) {
  // Dev-only relaxations, all no-ops in production builds: next dev's runtime
  // evaluates modules with eval (react-refresh dies without 'unsafe-eval' and
  // the page never hydrates — verified in a browser, the consoles render dead
  // HTML), local APIs move ports per worktree, and local minio serves images
  // over plain http.
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${dev ? ` 'unsafe-eval'` : ''}`,
    // Tailwind/styled-jsx inject style tags at runtime; style hashes are not
    // workable here, and CSS injection is a far weaker vector than script.
    `style-src 'self' 'unsafe-inline'`,
    // School logos, staff photos and gallery images are operator-supplied
    // URLs on hosts we do not control.
    `img-src 'self' data: blob: https:${dev ? ' http:' : ''}`,
    `connect-src 'self' https://api.sckools.com https://api.test.sckools.com http://127.0.0.1:3001 http://localhost:3001${dev ? ' http://127.0.0.1:* http://localhost:*' : ''}`,
    // Contact pages embed a Google Maps iframe.
    `frame-src https://www.google.com https://maps.google.com`,
    `frame-ancestors 'self' https://sckools.com https://*.sckools.com`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');

  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [
    '/app/:path*',
    '/platform/:path*',
    '/me/:path*',
    '/teacher/:path*',
    '/portal/:path*',
    '/login',
    '/owner',
    '/account/:path*',
    '/accept-invite',
    '/reset-password',
    '/forgot-password',
  ],
};
