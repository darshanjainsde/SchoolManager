import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from './tenant-context.service';
/**
 * Minimal people endpoints. Implemented in Phase 1 to (a) demonstrate the
 * two-layer authz pattern and (b) give the security tests something concrete
 * to attack. Full CRUD ships in Phase 3 (school admin core).
 *
 * The authz pattern, top to bottom, is:
 *   1. SchoolJwtGuard       — valid JWT, schoolId matches the host
 *   2. RolesGuard           — role allowed on this endpoint
 *   3. Tenant-scoped query  — withTenant(ctx.schoolId, ...) → RLS in Postgres
 *   4. Ownership check      — for "self-only" paths, compare resource owner
 *                             to JWT subject and 404 (not 403) when wrong, so
 *                             enumeration doesn't reveal which IDs exist.
 *
 * NOTE: User model has no firstName/lastName (those live on Teacher/Student).
 * STAFF role was removed; replaced by SCHOOL_ADMIN + TEACHER distinction.
 */
export declare class UsersController {
    private readonly tenantCtx;
    constructor(tenantCtx: TenantContextService);
    listUsers(): Promise<{
        email: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        role: import("@skoolos/db").$Enums.UserRole;
    }[]>;
    listStudents(): Promise<{
        email: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
    }[]>;
    getStudent(id: string, user: SchoolJwtPayload): Promise<{
        email: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
    }>;
    getTeacher(id: string, user: SchoolJwtPayload): Promise<{
        email: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
    }>;
    getUser(id: string, user: SchoolJwtPayload): Promise<{
        email: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        role: import("@skoolos/db").$Enums.UserRole;
    }>;
}
//# sourceMappingURL=users.controller.d.ts.map