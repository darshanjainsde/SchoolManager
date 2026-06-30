import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import type { TenantContext } from '../../modules/tenancy';
import type { AnyJwtPayload } from '../auth/jwt-payload';

/**
 * Records an audit row for every mutating request (POST/PUT/PATCH/DELETE)
 * once it has succeeded. Audit writes never block the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext; user?: AnyJwtPayload }>();
    const method = req.method?.toUpperCase();
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

    return next.handle().pipe(
      tap({
        next: () => {
          if (!isMutation) return;
          // Audit is disabled in tests — every audit write contends with the
          // beforeEach truncate and creates flaky races. Production paths still
          // emit normally because DISABLE_AUDIT is unset.
          if (process.env.DISABLE_AUDIT === 'true') return;
          const tenant = req.tenant;
          const user = req.user;
          const scope = tenant?.kind === 'platform' ? 'PLATFORM' : 'TENANT';
          // Fire-and-forget — never `await` inside an interceptor.
          this.audit.record({
            scope,
            schoolId: tenant?.kind === 'tenant' ? tenant.schoolId : null,
            actorId: user?.sub ?? null,
            actorType: user ? (user.aud === 'platform' ? 'platform' : 'user') : 'system',
            action: `${method} ${req.originalUrl ?? req.url}`,
            ip: (req.ip ?? req.socket?.remoteAddress) ?? null,
            userAgent: req.headers['user-agent']?.toString() ?? null,
          });
        },
      }),
    );
  }
}
