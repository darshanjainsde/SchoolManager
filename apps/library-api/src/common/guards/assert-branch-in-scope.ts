/**
 * The implementation moved to `@library/core` (`packages/library-core/src/branch-scope.ts`)
 * when `issue`/`returnBook`/`renew` did — those three call it and that package
 * cannot import `apps/library-api`. Re-exported from its original path so the
 * catalog / periods / fines / circulation call sites are unchanged and there
 * is still exactly one implementation of "is this row's branch in my scope".
 */
export { assertBranchInScope } from '@library/core';
