import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CopyCondition, LibraryTx } from '@library/db';

/**
 * A book came back damaged. Write it down; charge nothing.
 *
 * The PM ranks this DAILY and no route for it existed anywhere in the product,
 * even though `FineKind.DAMAGE` and `CopyCondition` have been in the schema
 * since the first migration. What a librarian did instead was keep a paper
 * diary — the second system the whole merge exists to delete — or say nothing,
 * and then the copy's condition is a fiction and nobody can tell whether the
 * next borrower did it.
 *
 * RECORDS, NEVER PRICES. This deliberately creates no `Fine`, and takes no
 * amount. Pricing damage is a money decision and belongs behind the same
 * deliberate-human gate as a lost book: the figure and its source visible at
 * the moment a person creates the charge. The counter's promise to the
 * librarian is "noting this costs the family nothing", and that promise is
 * exactly what keeps her noting it. The day a rupee figure appears here, she
 * stops recording damage and the condition column dies.
 *
 * NOT tied to an open issue. The note is about the COPY. She often notices a
 * torn page while shelving, hours after the child left, and a route that
 * demanded an active loan would send her back to the paper diary for precisely
 * the cases she most wants recorded. The audit row carries whoever last had it
 * so the history is still answerable.
 */

export interface RecordDamageInput {
  accessionNumber: string;
  condition: CopyCondition;
  /** What is actually wrong, in her words. "Last twenty pages torn." */
  note: string;
}

export interface RecordDamageResult {
  copyId: string;
  accessionNumber: string;
  title: string;
  condition: CopyCondition;
  /** Who had it last, if anyone — for the history, never to bill them. */
  lastBorrowerName: string | null;
}

export async function recordDamage(
  tx: LibraryTx,
  orgId: string,
  input: RecordDamageInput,
  actorUserId: string | null,
  now: Date,
): Promise<RecordDamageResult> {
  const accessionNumber = input.accessionNumber.trim();
  const copy = await tx.copy.findUnique({
    where: { orgId_accessionNumber: { orgId, accessionNumber } },
    select: {
      id: true,
      accessionNumber: true,
      condition: true,
      title: { select: { title: true } },
    },
  });
  if (!copy) throw new NotFoundException('That number is not in the register');

  // NEW is not a damage report. Refusing it keeps the audit trail meaningful —
  // "damaged, condition NEW" is a row nobody can act on later.
  if (input.condition === 'NEW') {
    throw new BadRequestException('Choose the condition the book is in now');
  }

  const note = input.note.trim();
  if (!note) throw new BadRequestException('Say what the damage is');

  // Most recent holder, open or returned. Recorded in the audit row only.
  const lastIssue = await tx.issue.findFirst({
    where: { orgId, copyId: copy.id },
    orderBy: { issuedAt: 'desc' },
    select: { id: true, member: { select: { firstName: true, lastName: true } } },
  });
  const lastBorrowerName = lastIssue
    ? `${lastIssue.member.firstName} ${lastIssue.member.lastName}`.trim()
    : null;

  await tx.copy.update({
    where: { id: copy.id },
    data: { condition: input.condition },
  });

  // `remarks` is APPENDED, never replaced — a copy accumulates a history, and
  // overwriting would erase the earlier damage the moment a second one is
  // noted. Raw SQL because Prisma's `update` cannot concatenate a string
  // column; same transaction, so it is atomic with the condition above.
  await tx.$executeRaw`
    UPDATE "Copy"
       SET "remarks" = COALESCE(NULLIF("remarks", '') || E'\n', '') ||
                       ${`${now.toISOString().slice(0, 10)} ${input.condition}: ${note}`}
     WHERE "id" = ${copy.id}::uuid
       AND "orgId" = ${orgId}::uuid
  `;

  await tx.auditLog.create({
    data: {
      orgId,
      actorUserId,
      action: 'circulation.copy.damage',
      entity: 'Copy',
      entityId: copy.id,
      before: { condition: copy.condition },
      after: {
        condition: input.condition,
        note,
        accessionNumber: copy.accessionNumber,
        lastIssueId: lastIssue?.id ?? null,
        lastBorrowerName,
        // Stated in the record itself, so a reader a year from now does not
        // have to infer it from the absence of a Fine row.
        charged: false,
      },
    },
  });

  return {
    copyId: copy.id,
    accessionNumber: copy.accessionNumber,
    title: copy.title.title,
    condition: input.condition,
    lastBorrowerName,
  };
}
