import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles, RolesGuard } from './roles.guard';

function makeContext(handler: unknown, req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('allows a handler with no @Roles decorator — allow-by-default is deliberate, opt-in per route', () => {
    class Ctrl {
      plain(): void {}
    }
    expect(guard.canActivate(makeContext(Ctrl.prototype.plain, {}))).toBe(true);
  });

  it('allows an undecorated handler even when req.user is absent entirely', () => {
    class Ctrl {
      plain(): void {}
    }
    expect(guard.canActivate(makeContext(Ctrl.prototype.plain, { user: undefined }))).toBe(true);
  });

  it('rejects with 401 when a role is required but req.user is absent', () => {
    class Ctrl {
      @Roles('ORG_OWNER')
      gated(): void {}
    }
    expect(() => guard.canActivate(makeContext(Ctrl.prototype.gated, {}))).toThrow(UnauthorizedException);
  });

  it('allows when req.user.role is one of the required roles', () => {
    class Ctrl {
      @Roles('ORG_OWNER', 'LIBRARIAN')
      gated(): void {}
    }
    const req = { user: { role: 'LIBRARIAN' } };
    expect(guard.canActivate(makeContext(Ctrl.prototype.gated, req))).toBe(true);
  });

  it('rejects with 403 when req.user.role is not one of the required roles', () => {
    class Ctrl {
      @Roles('ORG_OWNER')
      gated(): void {}
    }
    const req = { user: { role: 'MEMBER' } };
    expect(() => guard.canActivate(makeContext(Ctrl.prototype.gated, req))).toThrow(ForbiddenException);
  });
});
