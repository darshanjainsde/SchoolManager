import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * WHEN DID THIS INVOCATION BEGIN?
 *
 * A drain asked for by a request runs inside that request's invocation (via
 * waitUntil), and the function is killed 60 s after the INVOCATION began —
 * not after the drain began. A request that spent 30 s on work (a cold start,
 * a big import) and then asked for a drain used to hand it a full 45 s it did
 * not have; the last sends were killed mid-flight. The clock lets the signal
 * pass the real deadline.
 *
 * server.ts stamps `req.skInvokedAt` on entry (before the cold-start await);
 * this interceptor — registered first, so it wraps everything — carries it
 * through AsyncLocalStorage. Nest binds interceptor handlers with
 * AsyncResource, which is what makes the store visible in the service.
 */
const store = new AsyncLocalStorage<number>();

export function runInvocation<T>(fn: () => T, startedAt: number = Date.now()): T {
  return store.run(startedAt, fn);
}

export function invocationStartedAt(): number | undefined {
  return store.getStore();
}

@Injectable()
export class InvocationClockInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    let startedAt = Date.now();
    try {
      const stamped = context.switchToHttp().getRequest<{ skInvokedAt?: unknown }>()?.skInvokedAt;
      if (typeof stamped === 'number') startedAt = stamped;
    } catch {
      /* the clock must never affect a response */
    }
    return runInvocation(() => next.handle(), startedAt);
  }
}
