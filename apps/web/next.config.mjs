/**
 * Baseline response headers for every route.
 *
 * NOTE on framing: sckools.com/school-website-builder embeds a live school
 * site (beacon.sckools.com) in an <iframe>, and tenant hosts are *different*
 * origins — so `X-Frame-Options: SAMEORIGIN` would break that page. CSP
 * `frame-ancestors` is used instead because it can express "any sckools.com
 * host", which XFO cannot. Anything else framing us is still refused.
 *
 * A full CSP (script-src/style-src) is deliberately NOT set here: the app
 * ships inline JSON-LD, an inline theme script and inline <style> blocks, so
 * it needs a nonce pipeline first — tracked as a follow-up, not a silent gap.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self' https://sckools.com https://*.sckools.com",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework to attackers.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  /**
   * sckools.com/demo — the sales deck, served as a plain static file.
   *
   * It lives in `public/demo/index.html` — a self-contained page carrying its
   * own <html>, styles and script — so it cannot be an App Router page: those
   * render inside the root layout, which already owns the document. A rewrite
   * keeps the URL clean while Vercel serves the file from its static layer, so
   * there is no server work and nothing for the deck to depend on.
   *
   * It stays on the platform's own domain deliberately: a link handed to a
   * school should sit on the same name as the brochure and the email address.
   */
  async rewrites() {
    return [{ source: '/demo', destination: '/demo/index.html' }];
  },
};

export default nextConfig;
