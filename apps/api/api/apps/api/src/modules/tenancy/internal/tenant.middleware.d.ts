import type { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './tenant-context.service';
declare const ctxService: TenantContextService;
export declare function tenantMiddleware(req: Request, res: Response, next: NextFunction): void;
export { ctxService };
//# sourceMappingURL=tenant.middleware.d.ts.map