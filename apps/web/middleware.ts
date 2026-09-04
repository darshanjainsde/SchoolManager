import { NextResponse, type NextRequest } from 'next/server';
import { IS_LOCAL, OWNER_HOST } from '@/lib/hosts';

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
/**
 * The owner console is not part of a school's website, and must not be
 * reachable from one.
 *
 * The API already refuses platform data to anyone without a platform token,
 * so this is not what stops a breach — but the console SHELL was being served
 * on every host, including schools' own domains. A school that puts
 * archaiccandles.com in front of their site should not find our operator
 * console sitting at archaiccandles.com/platform: it is our surface on their
 * name, it invites credential-stuffing from an origin we do not watch, and it
 * tells every tenant that the operator console exists and where.
 *
 * 404 rather than 403 or a redirect: on a host where these routes do not
 * belong, the honest answer is that there is nothing there.
 */
function isOwnerOnlyRoute(pathname: string): boolean {
  return pathname === '/owner' || pathname === '/platform' || pathname.startsWith('/platform/');
}

function ownerRouteAllowed(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (host === OWNER_HOST) return true;

  // Safety valve for a config/deployment mismatch. If the build carries the
  // localhost defaults (NEXT_PUBLIC_PLATFORM_OWNER_HOST unset) but the request
  // arrived on a real host, we cannot know what the owner host is — and
  // guessing wrong here would 404 the operator's own console with no way back
  // in. Defence-in-depth is not worth a self-inflicted outage; the platform
  // JWT is still the control that matters.
  if (IS_LOCAL && !host.endsWith('localhost') && host !== '127.0.0.1') return true;

  return false;
}

export function middleware(req: NextRequest) {
  if (isOwnerOnlyRoute(req.nextUrl.pathname) && !ownerRouteAllowed(req)) {
    return new NextResponse(null, { status: 404 });
  }

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
    // Contact pages embed a Google Maps iframe; the Website Studio embeds the
    // same-origin /preview canvas (frame-src does NOT fall back to default-src,
    // so 'self' has to be listed explicitly or the studio frame is refused).
    `frame-src 'self' https://www.google.com https://maps.google.com`,
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
    '/teacher/:path*',
    '/portal/:path*',
    // The counter holds borrowing history — which child has which book, and who
    // owes what. It was added as a fourth top-level sibling to /portal,
    // /teacher and /staff and missed here, so it fell back to the baseline in
    // next.config.mjs, which sets only frame-ancestors: no connect-src, no
    // object-src, no form-action. `console-segments.test.ts` now fails if a
    // future sibling is forgotten the same way.
    '/library/:path*',
    '/staff/:path*',
    // The alumni portal holds a session too — and the ONE whose credential
    // JavaScript can read: `sk_alumni_session` lives in localStorage and is
    // sent as a bearer token to /alumni/me/*, which returns the directory
    // including opened emails and phone numbers. It was missed here because it
    // has no layout of its own and no useSessionProbe, which is exactly what
    // console-segments.test.ts looks for — so the guard could not see it
    // either. That test now detects a session by the CREDENTIAL as well.
    '/alumni/:path*',
    '/login',
    '/owner',
    '/account/:path*',
    '/accept-invite',
    '/reset-password',
    '/forgot-password',
  ],
};
