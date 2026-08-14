import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
/**
 * Verifies the request bears a platform-audience access token AND that it
 * arrives on the platform host. Both checks are required: a stolen platform
 * token cannot be used against a tenant subdomain, and a school user cannot
 * be granted platform access even on the right host without a platform token.
 */
export declare class PlatformJwtGuard implements CanActivate {
    private readonly jwt;
    private readonly reflector;
    private readonly env;
    constructor(jwt: JwtService, reflector: Reflector);
    canActivate(ctx: ExecutionContext): boolean;
}
//# sourceMappingURL=platform-jwt.guard.d.ts.map