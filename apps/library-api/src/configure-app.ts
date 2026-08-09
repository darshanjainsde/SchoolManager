import { ValidationPipe, type INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // INestApplication doesn't statically declare Express's `.set` (it's only
  // present at runtime because both main.ts and server.ts boot on the
  // Express platform); cast narrowly so `.set` stays optional/defensive
  // rather than widening the exported parameter type.
  (app as unknown as { set?: (field: string, value: unknown) => void }).set?.('trust proxy', 1);
}
