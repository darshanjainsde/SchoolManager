import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../tenancy';

@Injectable()
export class OwnerHostGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}
  canActivate(_ctx: ExecutionContext): boolean {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'platform') throw new ForbiddenException('Owner host required');
    return true;
  }
}
