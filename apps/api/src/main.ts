import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from '@skoolos/config';
import { configureApp } from './configure-app';

/** Local / container entrypoint — binds a port. Vercel uses `server.ts`. */
async function bootstrap() {
  const env = loadEnv();
  // rawBody:true keeps the unparsed body available for webhook signature checks.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app, env);
  await app.listen(env.API_PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap api:', err);
  process.exit(1);
});
