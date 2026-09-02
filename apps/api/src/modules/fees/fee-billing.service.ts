import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { applyBps, clampConcession } from './money';

/**
 * Step 5: turning the grid into bills.
 *
 * Two properties matter more than anything else here, and both are tested:
 *
 *   IDEMPOTENT. `FeeInvoice` is unique on (studentId, termId), so running
 *   generation twice bills nobody twice. A clerk who clicks the button again
 *   because the page was slow gets "0 new bills", not a duplicate term.
 *
 *   PREVIEWABLE. `preview()` runs the exact same computation as `generate()`
 *   and writes nothing, so the clerk sees the totals — and the count of
 *   affected students — before committing. They are the same code path, not
 *   two implementations that can drift.
 */

export interface PreviewLine {
  categoryId: string;
  categoryName: string;
  categoryDescription: string;
  grossMinor: number;
  concessionMinor: number;
  netMinor: number;
  concessionReason: string | null;
  isCollectible: boolean;
  order: number;
}

export interface PreviewInvoice {
  studentId: string;
  studentName: string;
  admissionNo: string;
  gradeName: string;
  lines: PreviewLine[];
  totalMinor: number;
  isRte: boolean;
  /** Already billed for this term — will be skipped by generate(). */
  alreadyBilled: boolean;
}

export interface GenerationSummary {
  termId: string;
  termName: string;
  students: number;
  toBill: number;
  alreadyBilled: number;
  skippedNoPlan: number;
  rteStudents: number;
  totalMinor: number;
  collectibleMinor: number;
  invoices: PreviewInvoice[];
}

@Injectable()
export class FeeBillingService {
  private readonly logger = new Logger(FeeBillingService.name);

  /**
   * Build every invoice for a term without writing anything.
   *
   * Deliberately loads the whole cohort in a handful of queries rather than
   * per student: at 10,000 students a per-student round trip is ~40,000
   * queries and a timeout, which is exactly the shape of bug the pitch flagged.
   */
  private async computeTerm(
    tx: TenantTx,
    schoolId: string,
    termId: string,
  ): Promise<GenerationSummary> {
    const term = await tx.feeTerm.findFirst({ where: { id: termId, schoolId } });
    if (!term) throw new ApiError('NOT_FOUND', 'Term not found', 404);

    const plan = await tx.feePlan.findFirst({
      where: { schoolId, academicYearId: term.academicYearId, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!plan) {
      throw new ApiError(
        'FEE_SETUP_INCOMPLETE',
        'No fee structure has been set up for this session yet.',
        409,
      );
    }

    const [categories, items, sections, existing] = await Promise.all([
      tx.feeCategory.findMany({ where: { schoolId, archivedAt: null } }),
      tx.feePlanItem.findMany({ where: { schoolId, planId: plan.id } }),
      tx.classSection.findMany({
        where: { schoolId, academicYearId: term.academicYearId },
        select: { id: true, gradeId: true, grade: { select: { name: true } } },
      }),
      tx.feeInvoice.findMany({ where: { schoolId, termId }, select: { studentId: true } }),
    ]);

    const students = await tx.student.findMany({
      where: { schoolId, isActive: true, classSectionId: { in: sections.map((s) => s.id) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classSectionId: true,
      },
      orderBy: [{ admissionNo: 'asc' }],
    });

    const [assignments, concessions] = await Promise.all([
      tx.feeAssignment.findMany({
        where: { schoolId, studentId: { in: students.map((s) => s.id) } },
      }),
      tx.feeConcession.findMany({
        where: {
          schoolId,
          studentId: { in: students.map((s) => s.id) },
          OR: [{ termId: null }, { termId }],
        },
      }),
    ]);

    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const assignByStudent = new Map(assignments.map((a) => [a.studentId, a]));
    const billedAlready = new Set(existing.map((e) => e.studentId));

    const concByStudent = new Map<string, typeof concessions>();
    for (const c of concessions) {
      const list = concByStudent.get(c.studentId) ?? [];
      list.push(c);
      concByStudent.set(c.studentId, list);
    }

    // A term-specific amount wins over the "same every term" row for the same cell.
    const cellKey = (gradeId: string, categoryId: string, t: string | null) =>
      `${gradeId}|${categoryId}|${t ?? '*'}`;
    const cells = new Map<string, number>();
    for (const i of items) cells.set(cellKey(i.gradeId, i.categoryId, i.termId), i.amountMinor);

    // ONE_TIME categories are billed only on a student's very first bill;
    // ANNUAL only on the first term of the session.
    const firstTermOfYear = await tx.feeTerm.findFirst({
      where: { schoolId, academicYearId: term.academicYearId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    const isFirstTerm = firstTermOfYear?.id === termId;
    const everBilled = new Set(
      (
        await tx.feeInvoice.findMany({
          where: { schoolId, studentId: { in: students.map((s) => s.id) } },
          select: { studentId: true },
          distinct: ['studentId'],
        })
      ).map((r) => r.studentId),
    );

    const invoices: PreviewInvoice[] = [];
    let skippedNoPlan = 0;
    let rteStudents = 0;

    for (const s of students) {
      const section = s.classSectionId ? sectionById.get(s.classSectionId) : undefined;
      if (!section) {
        skippedNoPlan++;
        continue;
      }
      const assign = assignByStudent.get(s.id);
      const optIns = new Set(assign?.optInCategoryIds ?? []);
      const isRte = assign?.isRte ?? false;
      if (isRte) rteStudents++;

      const lines: PreviewLine[] = [];
      let order = 0;

      for (const cat of categories) {
        if (cat.isOptional && !optIns.has(cat.id)) continue;
        if (cat.frequency === 'ONE_TIME' && everBilled.has(s.id)) continue;
        if (cat.frequency === 'ANNUAL' && !isFirstTerm) continue;

        const gross =
          cells.get(cellKey(section.gradeId, cat.id, termId)) ??
          cells.get(cellKey(section.gradeId, cat.id, null));
        if (!gross || gross <= 0) continue;

        // Concessions scoped to this category, plus whole-bill ones. Applied
        // in order, each against what is left, and clamped so a stack of
        // waivers can never take a line negative.
        const applicable = (concByStudent.get(s.id) ?? []).filter(
          (c) => c.categoryId === cat.id || c.categoryId === null,
        );
        let concession = 0;
        const reasons: string[] = [];
        for (const c of applicable) {
          const remaining = gross - concession;
          if (remaining <= 0) break;
          const amount =
            c.percentBps != null ? applyBps(remaining, c.percentBps) : (c.amountMinor ?? 0);
          const applied = clampConcession(remaining, amount);
          if (applied > 0) {
            concession += applied;
            reasons.push(c.reason);
          }
        }
        concession = clampConcession(gross, concession);

        lines.push({
          categoryId: cat.id,
          categoryName: cat.name,
          categoryDescription: cat.description,
          grossMinor: gross,
          concessionMinor: concession,
          netMinor: gross - concession,
          concessionReason: reasons.length ? reasons.join(' · ') : null,
          // An RTE student's collectible lines are recorded but never chased.
          isCollectible: cat.isCollectible && !isRte,
          order: order++,
        });
      }

      if (lines.length === 0) {
        skippedNoPlan++;
        continue;
      }

      invoices.push({
        studentId: s.id,
        studentName: `${s.firstName} ${s.lastName}`.trim(),
        admissionNo: s.admissionNo,
        gradeName: section.grade.name,
        lines,
        totalMinor: lines.reduce((a, l) => a + l.netMinor, 0),
        isRte,
        alreadyBilled: billedAlready.has(s.id),
      });
    }

    const toBill = invoices.filter((i) => !i.alreadyBilled);
    return {
      termId,
      termName: term.name,
      students: students.length,
      toBill: toBill.length,
      alreadyBilled: invoices.length - toBill.length,
      skippedNoPlan,
      rteStudents,
      totalMinor: toBill.reduce((a, i) => a + i.totalMinor, 0),
      collectibleMinor: toBill.reduce(
        (a, i) => a + i.lines.filter((l) => l.isCollectible).reduce((b, l) => b + l.netMinor, 0),
        0,
      ),
      invoices,
    };
  }

  /** Writes nothing. What the clerk sees before committing. */
  async preview(schoolId: string, termId: string): Promise<GenerationSummary> {
    return withTenant(schoolId, (tx) => this.computeTerm(tx, schoolId, termId));
  }

  /**
   * Issue the bills.
   *
   * The invoice row, its lines and the ledger debit are written together in
   * one transaction per student, so a failure part-way cannot leave a bill
   * with no ledger entry — which would silently understate what a school is
   * owed and never be noticed.
   */
  async generate(schoolId: string, termId: string) {
    return withTenant(schoolId, async (tx) => {
      const summary = await this.computeTerm(tx, schoolId, termId);
      const term = await tx.feeTerm.findFirstOrThrow({ where: { id: termId, schoolId } });
      const plan = await tx.feePlan.findFirstOrThrow({
        where: { schoolId, academicYearId: term.academicYearId, isActive: true },
        orderBy: { version: 'desc' },
      });

      const year = await tx.academicYear.findFirstOrThrow({
        where: { id: term.academicYearId },
        select: { name: true },
      });
      const series = `INV/${year.name}`;

      let created = 0;
      for (const inv of summary.invoices) {
        if (inv.alreadyBilled) continue;

        const [{ fee_next_number: seq }] = await tx.$queryRaw<{ fee_next_number: number }[]>`
          SELECT fee_next_number(${schoolId}::uuid, ${series}::text)
        `;
        const number = `${series}/${String(seq).padStart(5, '0')}`;

        const invoice = await tx.feeInvoice.create({
          data: {
            schoolId,
            studentId: inv.studentId,
            termId,
            planId: plan.id,
            number,
            dueDate: term.dueDate,
            totalMinor: inv.totalMinor,
            lines: {
              create: inv.lines.map((l) => ({
                schoolId,
                categoryId: l.categoryId,
                categoryName: l.categoryName,
                categoryDescription: l.categoryDescription,
                grossMinor: l.grossMinor,
                concessionMinor: l.concessionMinor,
                netMinor: l.netMinor,
                concessionReason: l.concessionReason,
                isCollectible: l.isCollectible,
                order: l.order,
              })),
            },
          },
        });

        if (inv.totalMinor > 0) {
          await tx.feeLedgerEntry.create({
            data: {
              schoolId,
              studentId: inv.studentId,
              kind: 'DEBIT',
              amountMinor: inv.totalMinor,
              refType: 'INVOICE',
              refId: invoice.id,
              narration: `${term.name} fees — ${number}`,
            },
          });
        }
        created++;
      }

      this.logger.log({ schoolId, termId, created }, 'fee bills generated');
      return { created, skipped: summary.alreadyBilled, totalMinor: summary.totalMinor };
    });
  }

  /** A student's balance. SUM over the ledger, never a stored column. */
  async balanceMinor(tx: TenantTx, schoolId: string, studentId: string): Promise<number> {
    const rows = await tx.feeLedgerEntry.groupBy({
      by: ['kind'],
      where: { schoolId, studentId },
      _sum: { amountMinor: true },
    });
    const debit = rows.find((r) => r.kind === 'DEBIT')?._sum.amountMinor ?? 0;
    const credit = rows.find((r) => r.kind === 'CREDIT')?._sum.amountMinor ?? 0;
    return debit - credit;
  }
}
