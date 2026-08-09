import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { OrgContext } from './org-lookup.service';

export const orgStore = new AsyncLocalStorage<OrgContext>();

@Injectable()
export class OrgContextService {
  current(): OrgContext | undefined { return orgStore.getStore(); }

  /** Throws rather than returning a default — an unresolved tenant must never fall back to "some org". */
  requireOrgId(): string {
    const ctx = this.current();
    if (!ctx || ctx.kind !== 'tenant') throw new Error('No tenant resolved for this request');
    return ctx.orgId;
  }
}
