import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuditService } from './audit.service';
/**
 * Records an audit row for every mutating request (POST/PUT/PATCH/DELETE)
 * once it has succeeded. Audit writes never block the response.
 */
export declare class AuditInterceptor implements NestInterceptor {
    private readonly audit;
    constructor(audit: AuditService);
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown>;
}
//# sourceMappingURL=audit.interceptor.d.ts.map