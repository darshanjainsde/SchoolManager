import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { PressOverview } from '@skoolos/types';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { seriesYear } from './report-card.service';

/**
 * The Press home in one read — the counter's scoreboard.
 *
 * Everything here is computed from the registers that already exist; nothing
 * is stored for this page. Per-class issued counts come from one findMany
 * over the window's issues (bounded by the roster ceiling: a window can hold
 * at most one live card per student), joined to the roster counts in JS —
 * the relation-_count shape is banned for a reason (tenant-aggregates guard).
 */
@Injectable()
export class PressOverviewService {
  async overview(schoolId: string, windowId?: string): Promise<PressOverview> {
    return withTenant(schoolId, async (tx) => {
      const windowRows = await tx.reportWindow.findMany({
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: LIST_CEILING.STRUCTURE,
        include: { academicYear: { select: { name: true } } },
      });
      const windows: PressOverview['windows'] = windowRows.map((w) => ({
        id: w.id,
        name: w.name,
        academicYearId: w.academicYearId,
        academicYearName: w.academicYear.name,
        startDate: w.startDate.toISOString().slice(0, 10),
        endDate: w.endDate.toISOString().slice(0, 10),
      }));
      const chosen = windowId
        ? windows.find((w) => w.id === windowId) ?? windows[0] ?? null
        : windows[0] ?? null;

      const [sections, rosterCounts, issueRows, registerLast, certLast, quoted, openOrders, certCount, registerTotal] =
        await Promise.all([
          tx.classSection.findMany({
            include: { grade: { select: { name: true, order: true } } },
            take: LIST_CEILING.STRUCTURE,
          }),
          tx.student.groupBy({
            by: ['classSectionId'],
            where: { isActive: true, classSectionId: { not: null } },
            _count: { _all: true },
          }),
          chosen
            ? tx.pressIssue.findMany({
                where: { type: 'REPORT_CARD', windowId: chosen.id, voidedAt: null },
                select: { student: { select: { classSectionId: true } } },
                take: LIST_CEILING.ROSTER,
              })
            : Promise.resolve([]),
          tx.pressIssue.findFirst({
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
            select: { serial: true },
          }),
          tx.pressIssue.findFirst({
            where: { type: { not: 'REPORT_CARD' }, voidedAt: null },
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
            select: { serial: true },
          }),
          tx.printOrder.findMany({
            where: { status: 'QUOTED' },
            select: { quotePriceMinor: true },
            take: LIST_CEILING.ACTIVITY,
          }),
          tx.printOrder.count({
            where: { status: { in: ['REQUESTED', 'QUOTED', 'CONFIRMED', 'PRINTING', 'DISPATCHED'] } },
          }),
          tx.pressIssue.count({
            where: {
              type: { not: 'REPORT_CARD' },
              voidedAt: null,
              issuedAt: { gte: new Date(`${seriesYear(new Date())}-01-01T00:00:00Z`) },
            },
          }),
          tx.pressIssue.count({ where: { voidedAt: null } }),
        ]);

      const issuedBySection = new Map<string, number>();
      for (const r of issueRows) {
        const cs = r.student.classSectionId;
        if (cs) issuedBySection.set(cs, (issuedBySection.get(cs) ?? 0) + 1);
      }
      const rosterBySection = new Map(rosterCounts.map((c) => [c.classSectionId, c._count._all]));

      const classes = sections
        .sort((a, b) => a.grade.order - b.grade.order || a.grade.name.localeCompare(b.grade.name) || a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          label: `${s.grade.name}-${s.name}`,
          students: rosterBySection.get(s.id) ?? 0,
          issued: issuedBySection.get(s.id) ?? 0,
        }));

      return {
        windows,
        windowId: chosen?.id ?? null,
        classes,
        register: { total: registerTotal, lastSerial: registerLast?.serial ?? null },
        certificates: { lastSerial: certLast?.serial ?? null, thisYear: certCount },
        orders: {
          awaitingConfirm: quoted.length,
          quotedTotalMinor: quoted.reduce((sum, q) => sum + (q.quotePriceMinor ?? 0), 0),
          open: openOrders,
        },
      };
    });
  }
}
