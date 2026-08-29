import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';
import { runWithRouteLabel } from './route-context';

/**
 * Times every request and hands it to MetricsService.
 *
 * Wrapped in try/catch at every step: this interceptor sits in front of the
 * entire API, so a bug here would be an outage. It must be incapable of
 * changing a response.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const started = Date.now();
    let label: string | null = null;
    try {
      const req = context.switchToHttp().getRequest<Request>();
      label = this.metrics.label(req.method, req.route?.path, req.originalUrl ?? req.url ?? '');
    } catch {
      return next.handle();
    }
    if (!label) return next.handle();

    const done = (status: number, err?: unknown): void => {
      try {
        this.metrics.record(label as string, status, Date.now() - started);
        if (err) this.metrics.recordError(label as string, (err as Error)?.message);
      } catch {
        /* metrics must never affect the response */
      }
    };

    // The label is put in AsyncLocalStorage so a tenant transaction fired deep
    // inside a service can be attributed back to this route.
    return runWithRouteLabel(label, () => next.handle()).pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          done(res?.statusCode ?? 200);
        },
        error: (err: unknown) => {
          const status = (err as { status?: number })?.status ?? 500;
          done(status, err);
        },
      }),
    );
  }
}
