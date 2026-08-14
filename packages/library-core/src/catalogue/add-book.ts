import { BadRequestException, ConflictException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

/**
 * Add a book, with its copies, in one action.
 *
 * The counter's version of cataloguing, and deliberately not the catalogue
 * editor: a title, an author, how many copies, and the numbers they take. A
 * school stocks in bursts and circulates daily, so the full editor, CSV import
 * and ISBN lookup stay where they are — this exists because a librarian whose
 * shelves are empty cannot open her own counter otherwise, and because "a
 * donation arrived, add it" is a weekly five-second job that should not require
 * a second console.
 *
 * NO PRICE FIELD, and that is load-bearing rather than an omission.
 * `copies.service.ts#add` seeds `Title.replacementPrice` from
 * `Copy.acquisitionCost` when the price is still unset — a real money rule with
 * its own reasoning. Rather than reimplement that rule here (two
 * implementations of what a parent is eventually asked to pay), this path sets
 * neither column. A price is set deliberately, on the screen built for it.
 */

export interface AddBookInput {
  title: string;
  /** Optional. One name as she would write it — not a parsed list. */
  author?: string | null;
  /**
   * The number written inside each front cover. Given explicitly, never
   * generated silently: the accession register is an auditor's document and a
   * school's numbering is its own. `suggestNextAccessionNumbers` proposes,
   * she disposes.
   */
  accessionNumbers: string[];
  branchId?: string | null;
}

export interface AddBookResult {
  titleId: string;
  title: string;
  copies: Array<{ copyId: string; accessionNumber: string }>;
}

/**
 * The next free numbers, when — and only when — this library numbers its books
 * with plain integers.
 *
 * Returns [] for an empty register or for any scheme this cannot read
 * (`ENG/2024/117`, `SCI-88`), rather than guessing. A suggestion that collides
 * with a school's own convention is worse than no suggestion: she would write
 * it inside a cover, and the register is the document an auditor reads.
 */
export async function suggestNextAccessionNumbers(
  tx: LibraryTx,
  orgId: string,
  count: number,
): Promise<string[]> {
  if (count < 1) return [];

  // Only rows that are entirely digits take part. `~ '^[0-9]+$'` is the whole
  // filter, so one oddly-numbered copy cannot drag the maximum somewhere
  // meaningless, and a register with NO numeric rows yields nothing at all.
  const rows = await tx.$queryRaw<Array<{ max: bigint | null }>>`
    SELECT MAX(("accessionNumber")::bigint) AS "max"
      FROM "Copy"
     WHERE "orgId" = ${orgId}::uuid
       AND "accessionNumber" ~ '^[0-9]+$'
  `;
  const max = rows[0]?.max;
  if (max === null || max === undefined) return [];

  const start = Number(max) + 1;
  return Array.from({ length: count }, (_, i) => String(start + i));
}

export async function addBook(
  tx: LibraryTx,
  orgId: string,
  input: AddBookInput,
  actorUserId: string | null,
): Promise<AddBookResult> {
  const title = input.title.trim();
  if (!title) throw new BadRequestException('Give the book a name');

  const numbers = input.accessionNumbers.map((n) => n.trim()).filter(Boolean);
  if (numbers.length === 0) throw new BadRequestException('Give each copy a number');

  // Caught here rather than by the unique index, because the index would fire
  // on the second INSERT and the message would name a constraint instead of
  // the mistake she made.
  if (new Set(numbers).size !== numbers.length) {
    throw new BadRequestException('Two copies cannot share a number');
  }

  const existing = await tx.copy.findMany({
    where: { orgId, accessionNumber: { in: numbers } },
    select: { accessionNumber: true },
  });
  if (existing.length > 0) {
    throw new ConflictException(
      `Already in the register: ${existing.map((c) => c.accessionNumber).join(', ')}`,
    );
  }

  // A branch is required by the schema. The counter has no branch concept —
  // one school, one library — so it takes the org's first branch unless told
  // otherwise, which is what provisioning creates.
  const branchId =
    input.branchId ??
    (await tx.branch.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!branchId) throw new BadRequestException('This library has no branch set up yet');

  const created = await tx.title.create({ data: { orgId, title } });

  const authorName = input.author?.trim();
  if (authorName) {
    // `sortName` is the unique key per org, so an author typed twice is one
    // row — otherwise every re-typing of "R K Narayan" becomes a new author
    // and the catalogue slowly stops being searchable by author at all.
    const sortName = authorName.toLowerCase();
    const author = await tx.author.upsert({
      where: { orgId_sortName: { orgId, sortName } },
      update: {},
      create: { orgId, name: authorName, sortName },
    });
    await tx.titleAuthor.create({ data: { titleId: created.id, authorId: author.id } });
  }

  const copies = [];
  for (const accessionNumber of numbers) {
    const copy = await tx.copy.create({
      data: { orgId, titleId: created.id, branchId, accessionNumber, status: 'AVAILABLE' },
    });
    copies.push({ copyId: copy.id, accessionNumber });
  }

  await tx.auditLog.create({
    data: {
      orgId,
      actorUserId,
      action: 'catalogue.book.add',
      entity: 'Title',
      entityId: created.id,
      after: { title, author: authorName ?? null, accessionNumbers: numbers, branchId },
    },
  });

  return { titleId: created.id, title, copies };
}
