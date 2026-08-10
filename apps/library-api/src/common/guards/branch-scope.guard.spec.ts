import { ForbiddenException } from '@nestjs/common';
import { BranchScopeGuard } from './branch-scope.guard';

const ctx = (user: unknown, params: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, params, query: {} }) }) }) as never;

describe('BranchScopeGuard', () => {
  const guard = new BranchScopeGuard();

  it('allows an org owner with no branch restriction', () => {
    expect(guard.canActivate(ctx({ role: 'ORG_OWNER', branches: [] }, { branchId: 'b1' }))).toBe(true);
  });

  it('allows a librarian reaching their own branch', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, { branchId: 'b1' }))).toBe(true);
  });

  it('rejects a librarian reaching another branch', () => {
    expect(() => guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, { branchId: 'b2' })))
      .toThrow(ForbiddenException);
  });

  it('allows a request that names no branch at all', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, {}))).toBe(true);
  });
});
