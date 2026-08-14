import { Injectable } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { issue, returnBook, type IssueResult, type ReturnResult } from '@library/core';
import type { IssueBookDto, ReturnBookDto } from './dto';

export type { IssueResult, ReturnResult };

/**
 * The Nest seam over `@library/core`'s circulation write paths — nothing more.
 *
 * The bodies of `issue` and `returnBook` (and their private
 * `promoteOrRelease` / `sweepExpiredReadyHolds` helpers, the `IssueDenial`
 * -> HTTP mapping, and `loadPolicy`) live in
 * `packages/library-core/src/circulation/issues.ts`. They moved out because
 * `apps/api` owns the librarian's counter in the Sckools console and cannot
 * import `apps/library-api` (`.dependency-cruiser.cjs`'s
 * `no-library-service-imports`); a second implementation of issue/return on
 * that side would be a second answer to "what does this child owe", which is
 * the exact divergence the money design exists to prevent.
 *
 * Read the moved functions for the concurrency, RLS and FK reasoning — in
 * particular that `issue_one_active_per_copy` (a partial unique index), NOT
 * this class and NOT the idempotency interceptor, is what makes a
 * double-issue impossible.
 *
 * NO constructor: this class injects nothing, exactly as before the move.
 * Do not "tidy" a dependency into it as a bare-typed parameter — `tsx` does
 * not reliably emit `design:paramtypes`, so it would silently resolve to
 * `undefined` on this path (LIBRARY-TRAPS.md #6). Use `@Inject()` if one is
 * ever genuinely needed.
 */
@Injectable()
export class IssuesService {
  async issue(
    tx: LibraryTx,
    orgId: string,
    dto: IssueBookDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<IssueResult> {
    return issue(tx, orgId, dto, actorUserId, now, allowedBranches);
  }

  async returnBook(
    tx: LibraryTx,
    orgId: string,
    dto: ReturnBookDto,
    actorUserId: string,
    now: Date,
    allowedBranches: string[],
  ): Promise<ReturnResult> {
    return returnBook(tx, orgId, dto, actorUserId, now, allowedBranches);
  }
}
