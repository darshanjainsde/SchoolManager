import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { assertPressDocType, type ConsoleSearch } from '@skoolos/types';

/**
 * The command bar's index: people and register serials, matched loosely,
 * capped hard. Finding is doing — a student hit carries their live fee
 * balance so the bar can say "Fees ₹8,500 due" without a second look-up on
 * the client.
 *
 * Everything reads under `withTenant`; the query is capped at 80 chars and
 * two characters minimum (below that every school matches half its roll).
 */
const EMPTY: ConsoleSearch = { students: [], teachers: [], staff: [], serials: [] };

@Injectable()
export class ConsoleSearchService {
  async search(schoolId: string, rawQ: string): Promise<ConsoleSearch> {
    const q = rawQ.trim().slice(0, 80);
    if (q.length < 2) return EMPTY;

    return withTenant(schoolId, async (tx) => {
      const contains = { contains: q, mode: 'insensitive' as const };
      const [students, teachers, staff, serialRows] = await Promise.all([
        tx.student.findMany({
          where: {
            OR: [
              { firstName: contains }, { lastName: contains },
              { admissionNo: contains }, { code: contains },
            ],
          },
          include: { classSection: { include: { grade: { select: { name: true } } } } },
          // Active children first — but left students stay findable: a TC or
          // an old report request is BY DEFINITION about somebody who left.
          orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
          take: 8,
        }),
        tx.teacher.findMany({
          where: { OR: [{ firstName: contains }, { lastName: contains }] },
          select: { id: true, firstName: true, lastName: true },
          orderBy: { firstName: 'asc' },
          take: 5,
        }),
        tx.staff.findMany({
          where: { OR: [{ firstName: contains }, { lastName: contains }] },
          select: { id: true, firstName: true, lastName: true, role: true },
          orderBy: { firstName: 'asc' },
          take: 5,
        }),
        // Serial fragments are 4+ chars ("TC/2", "0041") — shorter would match
        // every register row through the year segment.
        q.length >= 4
          ? tx.pressIssue.findMany({
              where: { serial: contains },
              include: { student: { select: { firstName: true, lastName: true } } },
              orderBy: { issuedAt: 'desc' },
              take: 5,
            })
          : Promise.resolve([]),
      ]);

      // One grouped read for every matched student's balance — never a query
      // per hit. Schools without FEES simply have an empty ledger, so the
      // balance is an honest zero and the bar shows no money chip.
      const ids = students.map((s) => s.id);
      const balances = ids.length
        ? await tx.feeLedgerEntry.groupBy({
            by: ['studentId', 'kind'],
            where: { studentId: { in: ids } },
            _sum: { amountMinor: true },
          })
        : [];
      const dueByStudent = new Map<string, number>();
      for (const b of balances) {
        const cur = dueByStudent.get(b.studentId) ?? 0;
        const amt = b._sum.amountMinor ?? 0;
        dueByStudent.set(b.studentId, cur + (b.kind === 'DEBIT' ? amt : -amt));
      }

      return {
        students: students.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          classLabel: s.classSection ? `${s.classSection.grade.name}-${s.classSection.name}` : null,
          admissionNo: s.admissionNo,
          rollNo: s.rollNo,
          isActive: s.isActive,
          feesDueMinor: Math.max(0, dueByStudent.get(s.id) ?? 0),
        })),
        teachers: teachers.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim() })),
        staff: staff.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), role: s.role })),
        serials: serialRows.map((r) => {
          assertPressDocType(r.type);
          return {
            id: r.id,
            type: r.type,
            serial: r.serial,
            studentId: r.studentId,
            studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
          };
        }),
      };
    });
  }
}
