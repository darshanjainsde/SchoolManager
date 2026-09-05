import { NextResponse, type NextRequest } from 'next/server';
import { IS_LOCAL, OWNER_HOST, PLATFORM_HOST, isPlatformHost } from '@/lib/hosts';

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
 * Tenant hosts are served from a host-routed copy of the school site.
 *
 * `raffles.sckools.com/` is rewritten to `/s/raffles.sckools.com` — the
 * visitor's URL never changes. This exists because reading the host from
 * `headers()` makes a route dynamic, and Next serves dynamic routes
 * `private, no-store`, which no CDN may cache. Setting Cache-Control from
 * here does not override that; it was tried on staging and the framework
 * header won. Putting the host in the path is what makes the page cacheable,
 * and the edge cache key already includes the host, so schools cannot share
 * an entry.
 */
const HOST_ROUTED_EXACT = new Set([
  '/', '/academics', '/admissions', '/gallery', '/contact', '/connect',
]);
/** Admin-built pages live at a frozen slug under /p/. */
const HOST_ROUTED_PREFIX = ['/p/'];

function hostRouted(pathname: string): boolean {
  return HOST_ROUTED_EXACT.has(pathname) || HOST_ROUTED_PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * `/s/...` is an internal address. A request that arrives asking for it
 * directly did not come through the rewrite above — it is someone typing
 * another school's hostname into our path to see what comes back. It gets
 * nothing, on every host including the platform's own.
 */
function isInternalSiteRoute(pathname: string): boolean {
  return pathname === '/s' || pathname.startsWith('/s/');
}

/**
 * Pages whose HTML is identical for every visitor, so the CDN may hold them.
 *
 * The audit found 22 of 22 public URLs answering `x-vercel-cache: MISS`: every
 * view of every school website re-ran SSR, an API call and eleven queries for
 * content that changed last month. Next marks these routes dynamic because
 * `lib/request.ts` reads the tenant host from `headers()`, and a dynamic route
 * is served `private, no-store` — which forbids both the edge cache and the
 * browser's.
 *
 * These paths are safe to cache because their server output depends on the
 * HOST and nothing else: `PublicSite` is rendered from `fetchPublicSite(host)`
 * alone, reads no cookie, and sets none. The edge cache key already includes
 * the host, so two schools never share an entry — that is what makes this safe
 * without any change to how tenancy is resolved.
 *
 * Anything that can carry a session is deliberately absent: /login, /alumni,
 * /app, /portal, /teacher, /staff, /library, /platform, /owner, /account.
 */
const CACHEABLE_TENANT_EXACT = new Set([
  '/', '/academics', '/admissions', '/gallery', '/contact', '/connect',
]);
const CACHEABLE_TENANT_PREFIX = ['/blog', '/p/', '/overview/'];
/** Marketing pages on the platform apex — the same reasoning, no tenant involved. */
const CACHEABLE_PLATFORM = new Set([
  '/pricing', '/privacy', '/terms', '/school-website-builder', '/blog',
]);

function cacheableFor(pathname: string, host: string): boolean {
  // The owner console's hostname is a platform host by `isPlatformHost`, which
  // would otherwise let the marketing list through on it. Nothing on the
  // operator's own domain belongs in a shared cache.
  if (host === OWNER_HOST) return false;
  if (isPlatformHost(host)) return CACHEABLE_PLATFORM.has(pathname);
  if (CACHEABLE_TENANT_EXACT.has(pathname)) return true;
  return CACHEABLE_TENANT_PREFIX.some((p) => pathname === p || pathname.startsWith(p));
}

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

  // Our own apex serves them too. sckools.com/owner is the one-password gate
  // (app/owner/page.tsx documents it in as many words), and unlocking there
  // navigates straight to /platform — so both have to answer on the apex or
  // the door opens onto nothing.
  //
  // This is NOT the case the gate was written for. Its threat is our console
  // appearing on a SCHOOL's brand: archaiccandles.com/platform advertises that
  // we exist and invites credential-stuffing from an origin nobody watches.
  // sckools.com is ours. A school subdomain and a school's custom domain both
  // still 404, which is the part that matters.
  //
  // Nothing here is the security boundary in any case. The API refuses every
  // platform route without BOTH the owner host and a platform JWT
  // (OwnerHostGuard + PlatformJwtGuard), and the gate password carries a
  // lockout and a 5/min throttle. This only decides which host will hand out
  // the shell.
  if (host === PLATFORM_HOST) return true;

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
  const pathname = req.nextUrl.pathname;
  if (isOwnerOnlyRoute(pathname) && !ownerRouteAllowed(req)) {
    return new NextResponse(null, { status: 404 });
  }
  // Never reachable from outside — only our own rewrite may produce it.
  if (isInternalSiteRoute(pathname)) {
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

  const bareHost = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();

  // School hosts get the host-routed, cacheable copy of the page.
  const res =
    !isPlatformHost(bareHost) && bareHost !== OWNER_HOST && hostRouted(pathname)
      ? NextResponse.rewrite(
          new URL(`/s/${encodeURIComponent(bareHost)}${pathname === '/' ? '' : pathname}`, req.url),
        )
      : NextResponse.next();
  res.headers.set('Content-Security-Policy', csp);

  // Let the CDN hold the anonymous public pages. 60s of shared cache with ten
  // minutes of stale-while-revalidate means the first visitor after an edit
  // pays for the render and everyone behind them is served from the edge,
  // including while the refresh happens. GET only: a POST must never be
  // answered from a cache.
  if (req.method === 'GET' && cacheableFor(pathname, bareHost)) {
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
  }
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
    // Public school-site and marketing pages — matched so the cache header
    // above can be applied. They carry no session; see cacheableFor.
    '/',
    '/academics',
    '/admissions',
    '/gallery',
    '/contact',
    '/connect',
    '/s/:path*',
    '/blog/:path*',
    '/p/:path*',
    '/overview/:path*',
    '/pricing',
    '/privacy',
    '/terms',
    '/school-website-builder',
    '/login',
    '/owner',
    '/account/:path*',
    '/accept-invite',
    '/reset-password',
    '/forgot-password',
  ],
};
