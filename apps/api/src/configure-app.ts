import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppEnv } from '@skoolos/config';
import { ApiErrorFilter } from './common/errors/api-error.filter';
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Shared application configuration applied by BOTH the local server
 * (`main.ts`, which calls `.listen()`) and the Vercel serverless entrypoint
 * (`server.ts`, which calls `.init()`). Keeping it here means the two runtimes
 * never drift.
 */
export function configureApp(app: INestApplication, env: AppEnv): void {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Normalizes every thrown error (ApiError, ValidationPipe failures, plain
  // HttpExceptions, unknown 500s) into the `{ code, message, field? }`
  // envelope so every client — including /manage/* — can switch on `code`.
  app.useGlobalFilters(new ApiErrorFilter());

  // Honour X-Forwarded-Host behind an ingress / CDN (Vercel, custom domains).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // No ETags on API responses.
  //
  // Express adds one to every JSON body and pairs it with
  // `Cache-Control: public, max-age=0, must-revalidate`, so the browser
  // revalidates on every call. When the payload has not changed the server
  // answers 304 — and Express writes a 304 WITHOUT the CORS headers the
  // `enableCors` middleware put on the 200. The console is on a different
  // origin to the API, so the browser discards that 304 and the fetch fails
  // with a bare "Failed to fetch": no status, nothing in the console, and
  // nothing in the API's own logs, which recorded a perfectly good 304.
  //
  // It only bites endpoints whose body is STABLE, which is why it looked
  // random. /owner/marketing-config returns the same six prices every time,
  // so its ETag never changes and it was broken 100% of the time; /owner/blog/
  // pending did it whenever the queue stayed empty; /owner/overview mostly
  // escaped because its counts move.
  //
  // Conditional caching buys nothing here — every response is authenticated,
  // per-user and already small — so the fix is to stop offering it rather than
  // to patch CORS onto the 304 path.
  app.getHttpAdapter().getInstance().set('etag', false);

  // Turning Express's ETag off is not enough on Vercel: the edge adds its own,
  // so the browser still revalidates and still gets a CORS-less 304. Telling
  // the browser not to store the response at all is what actually stops the
  // conditional request being made.
  //
  // Safe as a blanket default — nothing in this API sets Cache-Control
  // deliberately, and every response is authenticated and per-user, so none of
  // it was ever cacheable. A handler that wants caching can still overwrite
  // this header: it runs after this middleware.
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.enableCors({
    origin: buildCorsOrigin(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Forwarded-Host', 'X-Skoolos-Host', 'X-Skoolos-Client'],
  });

  // Swagger UI is opt-in via env so a misconfigured controller can't take down
  // the api at boot.
  if (env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    try {
      const swagger = new DocumentBuilder()
        .setTitle('Sckools API')
        .setDescription('Multi-tenant school management platform — REST API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, swagger);
      SwaggerModule.setup('api/docs', app, document);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Swagger doc generation failed:', (e as Error).message);
    }
  }
}

/**
 * Browsers on the school portals hit the API cross-origin. In development we
 * allow any `*.localhost`. In production we allow the platform apex and all
 * its subdomains, the owner host, every school's own verified domain, plus
 * any hosts in the comma-separated `CORS_EXTRA_ORIGINS` env.
 *
 * The custom-domain case is the one that used to be broken. It was served
 * only by `CORS_EXTRA_ORIGINS`, which means putting a school on its own
 * address required an env edit and an API redeploy — per school. Until that
 * happened every browser call from the school's domain was refused, and
 * because the rejection is thrown rather than returned, the browser saw a
 * bare 500 with no CORS header and no explanation.
 *
 * So the allowlist now reads from the same table the request path already
 * trusts: a `Domain` row that is LIVE is, by definition, a hostname we serve.
 * One source of truth, no redeploy, and revoking a domain revokes its origin.
 */
function buildCorsOrigin(env: AppEnv) {
  const platformHost = env.PLATFORM_HOST.toLowerCase();
  const ownerHost = env.PLATFORM_OWNER_HOST.toLowerCase();
  const extra = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Escape dots for the subdomain regex: sckools.com -> sckools\.com
  const hostRe = platformHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const platformOriginRe = new RegExp(`^https?://([a-z0-9-]+\\.)*${hostRe}(:\\d+)?$`, 'i');
  // Development convenience, and only that: paired with `credentials: true`,
  // a production deployment that trusts localhost origins is one SameSite
  // change away from letting a page on a developer's machine make credentialed
  // calls against real data.
  const allowLocalhost = env.NODE_ENV !== 'production';
  const localhostRe = /^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/i;

  /**
   * Verified custom domains, memoised briefly. CORS runs on every preflight,
   * so this must not become a database read per request; 60s matches the
   * host→tenant cache, so a newly verified domain starts working within the
   * same window everywhere.
   */
  let cache: { at: number; hosts: Set<string> } = { at: 0, hosts: new Set() };
  const TTL_MS = 60_000;

  async function liveDomains(): Promise<Set<string>> {
    if (Date.now() - cache.at < TTL_MS) return cache.hosts;
    try {
      const rows = await getPlatformPrisma().domain.findMany({
        where: { status: 'LIVE' },
        select: { hostname: true },
      });
      cache = { at: Date.now(), hosts: new Set(rows.map((r) => r.hostname.toLowerCase())) };
    } catch {
      // A database blip must not revoke every school's origin at once. Keep
      // serving the last known set and retry on the next request.
      cache = { ...cache, at: Date.now() - TTL_MS + 5_000 };
    }
    return cache.hosts;
  }

  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true); // same-origin / server-to-server / curl
    const o = origin.toLowerCase();
    if (
      (allowLocalhost && localhostRe.test(o)) ||
      platformOriginRe.test(o) ||
      o === `https://${ownerHost}` ||
      extra.includes(o)
    ) {
      return cb(null, true);
    }

    // Only a well-formed https origin can be a school domain — checking the
    // table for anything else invites junk lookups.
    let hostname: string;
    try {
      const u = new URL(o);
      if (u.protocol !== 'https:') return cb(null, false);
      hostname = u.hostname;
    } catch {
      return cb(null, false);
    }

    void liveDomains()
      // Refusal is `false`, not an Error. Throwing here produced a 500 with no
      // CORS headers, which tells the developer nothing; a clean deny lets the
      // browser report the actual same-origin-policy failure.
      .then((hosts) => cb(null, hosts.has(hostname)))
      .catch(() => cb(null, false));
  };
}
