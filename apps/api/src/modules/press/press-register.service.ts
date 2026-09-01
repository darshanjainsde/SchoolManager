import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  assertPressDocType,
  type MyReportCard,
  type PressIssueRow,
  type PressRegisterPage,
  type PressSnapshot,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

const PAGE_SIZE = 50;

/**
 * The register — the drawer every issued document lives in.
 *
 * Read-only by design: rows are written by the issuing services and never
 * edited. A "reprint" is `one()` returning the stored snapshot for the sheet
 * to render again, DUPLICATE-stamped by the caller.
 */
@Injectable()
export class PressRegisterService {
  async list(
    schoolId: string,
    opts: { type?: string; q?: string; cursor?: string },
  ): Promise<PressRegisterPage> {
    // A batch of forty issues can share one millisecond; without the id
    // tiebreaker, cursor pages over a tied issuedAt skip or repeat rows.
    const q = opts.q?.slice(0, 80);
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.pressIssue.findMany({
        where: {
          ...(opts.type ? { type: opts.type } : {}),
          ...(q
            ? {
                OR: [
                  { serial: { contains: q, mode: 'insensitive' } },
                  { student: { firstName: { contains: q, mode: 'insensitive' } } },
                  { student: { lastName: { contains: q, mode: 'insensitive' } } },
                  { student: { admissionNo: { contains: q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: { student: { select: { firstName: true, lastName: true } } },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: Math.min(PAGE_SIZE, LIST_CEILING.ACTIVITY) + 1,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      });

      const page = rows.slice(0, PAGE_SIZE);
      const items: PressIssueRow[] = page.map((r) => {
        assertPressDocType(r.type);
        return {
          id: r.id,
          type: r.type,
          serial: r.serial,
          studentId: r.studentId,
          studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
          issuedAt: r.issuedAt.toISOString(),
          voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
        };
      });
      return { items, nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1]!.id : null };
    });
  }

  /** One issue, snapshot included — the reprint path. */
  async one(schoolId: string, id: string): Promise<{ id: string; type: string; serial: string; issuedAt: string; voidedAt: string | null; voidNote: string | null; snapshot: PressSnapshot }> {
    return withTenant(schoolId, async (tx) => {
      const row = await tx.pressIssue.findFirst({ where: { id } });
      if (!row) throw new ApiError('NOT_FOUND', 'That register entry was not found.', 404);
      return {
        id: row.id,
        type: row.type,
        serial: row.serial,
        issuedAt: row.issuedAt.toISOString(),
        voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
        voidNote: row.voidNote,
        snapshot: row.payload as unknown as PressSnapshot,
      };
    });
  }

  /**
   * The one-way correction path: strike the entry through, never erase it.
   * The database trigger (`press_issue_immutable`) enforces that this is the
   * ONLY update the row will ever accept; the partial unique then frees the
   * once-per-window slot so a corrected card can be issued afresh.
   */
  async void(schoolId: string, id: string, note: string, voidedById: string): Promise<{ voided: true }> {
    await withTenant(schoolId, async (tx) => {
      const row = await tx.pressIssue.findFirst({ where: { id }, select: { id: true, voidedAt: true } });
      if (!row) throw new ApiError('NOT_FOUND', 'That register entry was not found.', 404);
      if (row.voidedAt) throw new ApiError('ALREADY_VOIDED', 'This entry is already voided.', 409);
      await tx.pressIssue.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById, voidNote: note.trim() },
      });
    });
    return { voided: true };
  }

  // ── The family's side ──────────────────────────────────────────────────────

  /**
   * `userId`, not a student id — the row is resolved from the caller's own
   * JWT, matching `FeePortalService`. No id parameter exists on the portal
   * routes, so no family can page through another child's documents.
   */
  async myReportCards(schoolId: string, userId: string): Promise<MyReportCard[]> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { userId }, select: { id: true } });
      if (!student) return [];
      const rows = await tx.pressIssue.findMany({
        where: { studentId: student.id, type: 'REPORT_CARD', voidedAt: null },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: LIST_CEILING.ACTIVITY,
      });
      return rows.map((r) => {
        const snap = r.payload as unknown as { windowName?: string; academicYearName?: string };
        return {
          id: r.id,
          serial: r.serial,
          windowName: snap.windowName ?? 'Report card',
          academicYearName: snap.academicYearName ?? '',
          issuedAt: r.issuedAt.toISOString(),
        };
      });
    });
  }

  /** One of MY cards, snapshot included — 404 for anyone else's, never 403. */
  async myReportCard(schoolId: string, userId: string, id: string): Promise<{ id: string; serial: string; issuedAt: string; snapshot: PressSnapshot }> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { userId }, select: { id: true } });
      const row = student
        ? await tx.pressIssue.findFirst({ where: { id, studentId: student.id, type: 'REPORT_CARD', voidedAt: null } })
        : null;
      if (!row) throw new ApiError('NOT_FOUND', 'That report card was not found.', 404);
      return {
        id: row.id,
        serial: row.serial,
        issuedAt: row.issuedAt.toISOString(),
        snapshot: row.payload as unknown as PressSnapshot,
      };
    });
  }
}
