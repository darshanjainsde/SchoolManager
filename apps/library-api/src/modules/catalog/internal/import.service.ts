import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { withOrg, type LibraryTx } from '@library/db';

export interface RowError {
  /** 1-indexed position among DATA rows — i.e. the row directly below the header is row 1. */
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: RowError[];
}

export interface ImportOptions {
  dryRun?: boolean;
}

export interface ParsedTitleRow {
  isbn13?: string;
  isbn10?: string;
  title: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  publishedYear?: number;
  edition?: string;
  language?: string;
  callNumber?: string;
  category?: string;
}

/** Hard cap so a request fits comfortably inside the 60s serverless function budget. */
export const MAX_IMPORT_ROWS = 2000;

const ISBN_13_RE = /^\d{13}$/;
const ISBN_10_RE = /^\d{9}[\dX]$/;

/**
 * Pure row validation/mapping — no `tx`, no I/O, so it is unit-testable
 * without a database. Every failure returns a `RowError` instead of
 * throwing: the caller (`ImportService.applyRows`) is what turns "this row
 * has a problem" into "skip this row and keep going", and it can only do
 * that if failures come back as data, not as control flow that would abort
 * the whole file.
 */
export function mapImportRow(record: Record<string, string>, row: number): { data: ParsedTitleRow } | { error: RowError } {
  const isbnRaw = (record.isbn ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!isbnRaw) return { error: { row, field: 'isbn', message: 'isbn is required' } };
  if (!ISBN_13_RE.test(isbnRaw) && !ISBN_10_RE.test(isbnRaw)) {
    return { error: { row, field: 'isbn', message: 'isbn must be 10 or 13 characters' } };
  }

  const title = (record.title ?? '').trim();
  if (!title) return { error: { row, field: 'title', message: 'title is required' } };

  let publishedYear: number | undefined;
  const publishedYearRaw = record.publishedyear;
  if (publishedYearRaw) {
    const n = Number(publishedYearRaw);
    if (!Number.isInteger(n) || n < 0 || n > 3000) {
      return { error: { row, field: 'publishedYear', message: 'publishedYear must be an integer between 0 and 3000' } };
    }
    publishedYear = n;
  }

  const isThirteen = ISBN_13_RE.test(isbnRaw);

  return {
    data: {
      isbn13: isThirteen ? isbnRaw : undefined,
      isbn10: isThirteen ? undefined : isbnRaw,
      title,
      subtitle: record.subtitle || undefined,
      author: record.author || undefined,
      publisher: record.publisher || undefined,
      publishedYear,
      edition: record.edition || undefined,
      language: record.language || undefined,
      callNumber: record.callnumber || undefined,
      category: record.category || undefined,
    },
  };
}

@Injectable()
export class ImportService {
  /**
   * Runs the whole file inside ONE `withOrg` transaction and either commits
   * it (real run) or rolls it back (dry run) — the two modes share the
   * exact same code path (`applyRows`) all the way through, so "what a dry
   * run reports" and "what a real run would do" cannot drift apart into two
   * independently-maintained implementations. `DRY_RUN_ROLLBACK` is thrown
   * from inside the transaction callback purely to make Prisma roll it
   * back; it is caught here and never surfaces to the caller.
   */
  async importTitles(orgId: string, rows: Record<string, string>[], opts: ImportOptions = {}): Promise<ImportResult> {
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new PayloadTooLargeException(`Import is capped at ${MAX_IMPORT_ROWS} rows per request`);
    }

    const DRY_RUN_ROLLBACK = Symbol('import-dry-run-rollback');
    let result: ImportResult | undefined;
    try {
      await withOrg(orgId, async (tx) => {
        result = await this.applyRows(tx, orgId, rows);
        if (opts.dryRun) throw DRY_RUN_ROLLBACK;
      });
    } catch (err) {
      if (err !== DRY_RUN_ROLLBACK) throw err;
    }
    return result!;
  }

  private async applyRows(tx: LibraryTx, orgId: string, rows: Record<string, string>[]): Promise<ImportResult> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: RowError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const mapped = mapImportRow(rows[i], rowNum);
      if ('error' in mapped) {
        errors.push(mapped.error);
        skipped++;
        continue;
      }
      const data = mapped.data;

      // Client-supplied foreign key, by way of a name instead of a raw id:
      // `data.category` is free text from the CSV that has to resolve to a
      // Category row before it can be linked. Both the lookup and the
      // fallback create happen on `tx` — inside this same withOrg
      // transaction — so RLS scopes the findFirst to this org's own
      // categories only. A lookup on an unscoped connection (e.g. the
      // platform client) would let a category NAME collide across orgs and
      // link this org's title to a category row it cannot see or own; this
      // is the exact "category name that resolves to an id" case the task
      // brief calls out, and the guard this module has already broken
      // twice (see titles.service.ts / categories.service.ts for the same
      // pattern on client-supplied UUIDs).
      let categoryId: string | undefined;
      if (data.category) {
        const existingCategory = await tx.category.findFirst({ where: { name: data.category }, select: { id: true } });
        categoryId = existingCategory
          ? existingCategory.id
          : (await tx.category.create({ data: { orgId, name: data.category } })).id;
      }

      // Same find-or-create-by-unique-key shape TitlesService.create already
      // uses for authors (orgId_sortName) — a single author name repeated
      // across many rows/files resolves to one Author row, not a duplicate
      // per row.
      let authorLink: { authorId: string; role: 'AUTHOR' } | undefined;
      if (data.author) {
        const sortName = data.author;
        const author = await tx.author.upsert({
          where: { orgId_sortName: { orgId, sortName } },
          update: {},
          create: { orgId, name: data.author, sortName },
        });
        authorLink = { authorId: author.id, role: 'AUTHOR' };
      }

      // Idempotency key: ISBN within this org. No orgId filter needed in
      // the WHERE — `tx` is already RLS-scoped to `orgId` via withOrg's
      // `SET LOCAL app.current_org`, the same convention
      // CategoriesService/CopiesService rely on elsewhere in this module.
      // There is no `@@unique([orgId, isbn13])` backing this at the
      // database level (see import-report.md "Concerns" — this makes
      // re-importing the SAME file safe, but two truly concurrent imports
      // of files sharing an ISBN could still both miss and both create).
      const existingTitle = data.isbn13
        ? await tx.title.findFirst({ where: { isbn13: data.isbn13 }, select: { id: true } })
        : await tx.title.findFirst({ where: { isbn10: data.isbn10 }, select: { id: true } });

      if (existingTitle) {
        // Scalar fields only, and only the ones this row actually carries a
        // value for — an empty CSV cell must not blank out a field a
        // previous import (or the manual catalogue UI) already populated.
        // Relinking authors/categories on update is deliberately out of
        // scope, same call `UpdateTitleDto` already makes for the single-
        // title PATCH endpoint.
        await tx.title.update({
          where: { id: existingTitle.id },
          data: {
            title: data.title,
            subtitle: data.subtitle,
            publisher: data.publisher,
            publishedYear: data.publishedYear,
            edition: data.edition,
            language: data.language,
            callNumber: data.callNumber,
          },
        });
        updated++;
      } else {
        await tx.title.create({
          data: {
            orgId,
            isbn13: data.isbn13,
            isbn10: data.isbn10,
            title: data.title,
            subtitle: data.subtitle,
            publisher: data.publisher,
            publishedYear: data.publishedYear,
            edition: data.edition,
            language: data.language ?? 'en',
            callNumber: data.callNumber,
            authors: authorLink ? { create: [authorLink] } : undefined,
            categories: categoryId ? { create: [{ categoryId }] } : undefined,
          },
        });
        created++;
      }
    }

    return { created, updated, skipped, errors };
  }
}
