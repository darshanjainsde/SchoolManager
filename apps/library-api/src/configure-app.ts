import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ALLOWED_HEADERS, ALLOWED_METHODS, isAllowedOrigin } from './cors';

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // The console runs on a different origin to this API (a tenant subdomain
  // calling api.library…), so every one of its requests is preflighted. See
  // cors.ts for which origins are allowed and why this was invisible until
  // the UI was driven in a real browser.
  const isProduction = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Never throw on a disallowed origin: an error here becomes a 500, which
      // reads as "the API is broken" instead of "that origin is not allowed".
      cb(null, isAllowedOrigin(origin, isProduction));
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: false,
    maxAge: 86_400,
  });

  // INestApplication doesn't statically declare Express's `.set` (it's only
  // present at runtime because both main.ts and server.ts boot on the
  // Express platform); cast narrowly so `.set` stays optional/defensive
  // rather than widening the exported parameter type.
  (app as unknown as { set?: (field: string, value: unknown) => void }).set?.('trust proxy', 1);
}
