import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
/**
 * Verifies the request bears a school-audience access token AND that the
 * token's schoolId matches the schoolId the tenant-resolution middleware
 * derived from the host. A token issued for school A cannot be replayed
 * against school B's subdomain.
 */
export declare class SchoolJwtGuard implements CanActivate {
    private readonly jwt;
    private readonly reflector;
    private readonly env;
    constructor(jwt: JwtService, reflector: Reflector);
    canActivate(ctx: ExecutionContext): boolean;
}
//# sourceMappingURL=school-jwt.guard.d.ts.map