import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadEnv } from '@skoolos/config';

async function bootstrap() {
  const env = loadEnv();
  // rawBody:true lets the Stripe webhook controller verify signatures against
  // the unparsed body. The body is still JSON-parsed for every other route.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // Honour X-Forwarded-Host behind an ingress (cert-manager, custom domains).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Allow browser requests from any *.localhost subdomain (school portals) and
  // the plain localhost origin (platform portal). In production this is locked
  // down via the ingress/CDN layer, not here.
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || /^https?:\/\/([a-z0-9-]+\.)*localhost(:\d+)?$/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Forwarded-Host'],
  });

  // Swagger UI is opt-in via env so a misconfigured controller can't take down
  // the api at boot — security tests still cover all endpoints whether the
  // doc page is exposed or not.
  if (env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    try {
      const swagger = new DocumentBuilder()
        .setTitle('SkoolOS API')
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

  await app.listen(env.API_PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap api:', err);
  process.exit(1);
});
