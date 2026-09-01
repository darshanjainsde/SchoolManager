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
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.pressIssue.findMany({
        where: {
          ...(opts.type ? { type: opts.type } : {}),
          ...(opts.q
            ? {
                OR: [
                  { serial: { contains: opts.q, mode: 'insensitive' } },
                  { student: { firstName: { contains: opts.q, mode: 'insensitive' } } },
                  { student: { lastName: { contains: opts.q, mode: 'insensitive' } } },
                  { student: { admissionNo: { contains: opts.q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: { student: { select: { firstName: true, lastName: true } } },
        orderBy: { issuedAt: 'desc' },
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
        };
      });
      return { items, nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1]!.id : null };
    });
  }

  /** One issue, snapshot included — the reprint path. */
  async one(schoolId: string, id: string): Promise<{ id: string; type: string; serial: string; issuedAt: string; snapshot: PressSnapshot }> {
    return withTenant(schoolId, async (tx) => {
      const row = await tx.pressIssue.findFirst({ where: { id } });
      if (!row) throw new ApiError('NOT_FOUND', 'That register entry was not found.', 404);
      return {
        id: row.id,
        type: row.type,
        serial: row.serial,
        issuedAt: row.issuedAt.toISOString(),
        snapshot: row.payload as unknown as PressSnapshot,
      };
    });
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
        where: { studentId: student.id, type: 'REPORT_CARD' },
        orderBy: { issuedAt: 'desc' },
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
        ? await tx.pressIssue.findFirst({ where: { id, studentId: student.id, type: 'REPORT_CARD' } })
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
