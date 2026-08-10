import { resolvePlan } from './resolve';

describe('resolvePlan', () => {
  it('gives FREE the operational capabilities but no money features', () => {
    const { capabilities, quotas } = resolvePlan('FREE', []);
    expect(capabilities.has('CATALOG')).toBe(true);
    expect(capabilities.has('CIRCULATION')).toBe(true);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(false);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('gives MINI the money features but still one branch and one admin', () => {
    const { capabilities, quotas } = resolvePlan('MINI', []);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(true);
    expect(capabilities.has('WHATSAPP_RECEIPT')).toBe(true);
    expect(capabilities.has('MULTI_BRANCH')).toBe(false);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('gives PRO everything MINI has, plus unlimited branches and admins', () => {
    const mini = resolvePlan('MINI', []).capabilities;
    const { capabilities, quotas } = resolvePlan('PRO', []);
    for (const key of mini) expect(capabilities.has(key)).toBe(true);
    expect(capabilities.has('MULTI_BRANCH')).toBe(true);
    expect(quotas).toEqual({ branches: Infinity, adminSeats: Infinity });
  });

  it('lets an override switch a capability on for one org', () => {
    const { capabilities } = resolvePlan('FREE', [{ key: 'REVENUE_DASHBOARD', enabled: true }]);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(true);
  });

  it('lets an override switch a capability off', () => {
    const { capabilities } = resolvePlan('PRO', [{ key: 'MULTI_BRANCH', enabled: false }]);
    expect(capabilities.has('MULTI_BRANCH')).toBe(false);
  });

  it('ignores an override naming a capability that does not exist', () => {
    const { capabilities } = resolvePlan('FREE', [{ key: 'NOT_A_REAL_KEY', enabled: true }]);
    expect(capabilities.has('NOT_A_REAL_KEY' as never)).toBe(false);
  });
});
