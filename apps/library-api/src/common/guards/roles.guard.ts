import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LibJwtPayload } from '../../modules/auth';

export type LibRole = LibJwtPayload['role'];

export const ROLES_KEY = 'library:roles';

/**
 * Marks a handler/controller as restricted to one or more roles. Absence of
 * this decorator is a deliberate "no restriction" — RolesGuard allows any
 * request through an undecorated route, role enforcement is opt-in per
 * route, the same shape as @RequireFeature/RequireFeatureGuard.
 */
export const Roles = (...roles: LibRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/**
 * Role gate. There is no global JWT guard by design (see LibJwtGuard), so
 * req.user may legitimately be absent even on a route that declares
 * required roles — that combination is rejected with 401 (we don't know who
 * this is), never allowed through and never a crash from reading `.role`
 * off `undefined`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  // Explicit @Inject(): tsx does not reliably emit design:paramtypes, so a
  // bare-typed constructor param can silently resolve to undefined — in a
  // guard that is a fail-open risk.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<LibRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role: LibRole | undefined = req.user?.role;
    if (!role) throw new UnauthorizedException();
    if (!required.includes(role)) {
      throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
