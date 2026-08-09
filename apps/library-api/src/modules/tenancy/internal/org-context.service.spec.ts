import { OrgContextService, orgStore } from './org-context.service';
import type { OrgContext } from './org-lookup.service';

describe('OrgContextService', () => {
  const service = new OrgContextService();

  it('current() returns undefined outside any resolved request scope', () => {
    expect(service.current()).toBeUndefined();
  });

  it('requireOrgId() throws when no tenant has been resolved for this request', () => {
    expect(() => service.requireOrgId()).toThrow('No tenant resolved for this request');
  });

  it('requireOrgId() throws when the context exists but is unknown (kind !== "tenant")', () => {
    const ctx: OrgContext = { kind: 'unknown', hostname: 'nope.example.com' };
    orgStore.run(ctx, () => {
      expect(() => service.requireOrgId()).toThrow('No tenant resolved for this request');
    });
  });

  it('requireOrgId() returns the orgId only for a resolved tenant context', () => {
    const ctx: OrgContext = {
      kind: 'tenant',
      orgId: 'b7ae2292-7b0f-4eed-9044-655678e0f48a',
      orgSlug: 'raffles',
      hostname: 'raffles.library.trackyour.in',
    };
    orgStore.run(ctx, () => {
      expect(service.requireOrgId()).toBe('b7ae2292-7b0f-4eed-9044-655678e0f48a');
    });
  });
});
