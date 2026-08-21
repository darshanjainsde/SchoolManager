import type { INestApplication } from '@nestjs/common';
import type { AppEnv } from '@skoolos/config';
/**
 * Shared application configuration applied by BOTH the local server
 * (`main.ts`, which calls `.listen()`) and the Vercel serverless entrypoint
 * (`server.ts`, which calls `.init()`). Keeping it here means the two runtimes
 * never drift.
 */
export declare function configureApp(app: INestApplication, env: AppEnv): void;
//# sourceMappingURL=configure-app.d.ts.map