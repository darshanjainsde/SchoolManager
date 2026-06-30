import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@skoolos/db';
import type { SchoolJwtPayload } from './jwt-payload';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) throw new ForbiddenException();
    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException('Role not permitted');
    }
    return true;
  }
}
