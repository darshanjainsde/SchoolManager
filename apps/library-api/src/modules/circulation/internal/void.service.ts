import { Injectable } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { voidIssue, type VoidIssueResult } from '@library/core';

export type { VoidIssueResult };

/**
 * Undo an issue that should never have happened.
 *
 * The implementation moved to `@library/core` (`circulation/void.ts`) so the
 * librarian's counter inside Sckools can call the same one — `apps/api` cannot
 * import this app. Every reason this behaves the way it does (why it DELETES
 * the row rather than adding an `IssueStatus.VOID`, what may be voided, why the
 * automatic attendance mark is removed, why there is no time limit) is
 * documented there, at the code it explains.
 *
 * This class stays because the controller injects it and because a Nest
 * provider is the seam where request-scoped concerns would go if this ever
 * needs any. It adds no logic of its own — anything added here would be a rule
 * the counter does not get.
 */
@Injectable()
export class VoidService {
  voidIssue(
    tx: LibraryTx,
    orgId: string,
    issueId: string,
    reason: string,
    actorUserId: string | null,
  ): Promise<VoidIssueResult> {
    return voidIssue(tx, orgId, issueId, reason, actorUserId);
  }
}
