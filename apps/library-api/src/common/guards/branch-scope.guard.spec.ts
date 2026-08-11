import { ForbiddenException } from '@nestjs/common';
import { BranchScopeGuard } from './branch-scope.guard';

const ctx = (user: unknown, params: Record<string, string>, body: Record<string, unknown> = {}) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, params, query: {}, body }) }) }) as never;

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

  // AddCopyDto.branchId is a BODY field, not a param or query string — this
  // is the actual bug that made the guard inert on every real catalogue
  // route (params/query were always empty for these requests).
  it('allows a librarian adding a copy to their own branch via a body branchId', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, {}, { branchId: 'b1' }))).toBe(true);
  });

  it('rejects a librarian adding a copy to another branch via a body branchId', () => {
    expect(() => guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, {}, { branchId: 'b2' })))
      .toThrow(ForbiddenException);
  });

  it('allows a librarian with an empty branches array to reach any branch via body branchId', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: [] }, {}, { branchId: 'anything' }))).toBe(true);
  });
});
