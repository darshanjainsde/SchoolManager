import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppEnv } from '@skoolos/config';
import { ApiErrorFilter } from './common/errors/api-error.filter';

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

  app.enableCors({
    origin: buildCorsOrigin(env),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Forwarded-Host', 'X-Skoolos-Host'],
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
 * allow any `*.localhost`. In production we allow the platform apex and all its
 * subdomains (e.g. `skoolos.app` + `*.skoolos.app`), the owner host, plus any
 * hosts in the comma-separated `CORS_EXTRA_ORIGINS` env (for custom domains).
 */
function buildCorsOrigin(env: AppEnv) {
  const platformHost = env.PLATFORM_HOST.toLowerCase();
  const ownerHost = env.PLATFORM_OWNER_HOST.toLowerCase();
  const extra = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Escape dots for the subdomain regex: skoolos.app -> skoolos\.app
  const hostRe = platformHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const platformOriginRe = new RegExp(`^https?://([a-z0-9-]+\\.)*${hostRe}(:\\d+)?$`, 'i');
  // Development convenience, and only that: paired with `credentials: true`,
  // a production deployment that trusts localhost origins is one SameSite
  // change away from letting a page on a developer's machine make credentialed
  // calls against real data.
  const allowLocalhost = env.NODE_ENV !== 'production';
  const localhostRe = /^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/i;

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
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  };
}
