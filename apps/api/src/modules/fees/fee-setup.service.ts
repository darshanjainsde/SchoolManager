import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import type {
  SaveCategoryDto,
  SaveConcessionDto,
  SaveGridDto,
  SaveTermsDto,
} from './fees.dto';

/**
 * Steps 1–4 of the admin's setup: categories, terms, the class × category
 * grid, and per-student exceptions.
 *
 * The whole module is shaped around one constraint from the pitch — the person
 * using this is a school accounts clerk who currently keeps the fee structure
 * in a spreadsheet. So the grid is stored and returned in exactly the shape it
 * is edited in, and a save is a whole-grid replace rather than a cell-by-cell
 * PATCH. That means the screen never has to reconcile a partially-applied
 * edit, which is the failure a clerk would have no way to recover from.
 */

/** What a school starts with, so step 1 is a two-minute edit, not a blank page. */
export const STARTER_CATEGORIES: {
  name: string;
  description: string;
  frequency: 'PER_TERM' | 'ANNUAL' | 'ONE_TIME';
  isOptional: boolean;
}[] = [
  { name: 'Tuition', description: 'Classroom teaching, learning materials and school upkeep', frequency: 'PER_TERM', isOptional: false },
  { name: 'Admission', description: 'One-time charge when a student joins the school', frequency: 'ONE_TIME', isOptional: false },
  { name: 'Transport', description: 'School bus, by route — only if you use the bus', frequency: 'PER_TERM', isOptional: true },
  { name: 'Exam', description: 'Question papers, answer sheets and result processing', frequency: 'PER_TERM', isOptional: false },
  { name: 'Computer lab', description: 'Computer room, internet and software for practicals', frequency: 'PER_TERM', isOptional: false },
  { name: 'Science lab', description: 'Laboratory chemicals, apparatus and safety equipment', frequency: 'PER_TERM', isOptional: false },
  { name: 'Library', description: 'Books, periodicals and reading room upkeep', frequency: 'PER_TERM', isOptional: false },
  { name: 'Sports', description: 'Games equipment, ground upkeep and coaching', frequency: 'PER_TERM', isOptional: false },
  { name: 'Books', description: 'Textbook and notebook set for the session', frequency: 'ANNUAL', isOptional: true },
  { name: 'Uniform', description: 'School uniform set', frequency: 'ANNUAL', isOptional: true },
];

export interface GridCell {
  gradeId: string;
  categoryId: string;
  /** Null means "same in every term" — the normal case. */
  termId: string | null;
  amountMinor: number;
}

@Injectable()
export class FeeSetupService {
  private readonly logger = new Logger(FeeSetupService.name);

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.feeCategory.findMany({
        where: { schoolId, archivedAt: null },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  /**
   * Seeds the starter set the first time a school opens the fees screen. Idempotent:
   * a school that has already edited its categories gets nothing new, and a
   * category the school deleted is not resurrected (archived rows still occupy
   * the unique name).
   */
  async seedCategories(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.feeCategory.count({ where: { schoolId } });
      if (existing > 0) return { seeded: 0 };
      await tx.feeCategory.createMany({
        data: STARTER_CATEGORIES.map((c, i) => ({ ...c, schoolId, order: i })),
      });
      return { seeded: STARTER_CATEGORIES.length };
    });
  }

  async saveCategory(schoolId: string, dto: SaveCategoryDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.id) {
        const found = await tx.feeCategory.findFirst({ where: { id: dto.id, schoolId } });
        if (!found) throw new ApiError('NOT_FOUND', 'Fee category not found', 404);
        return tx.feeCategory.update({
          where: { id: dto.id },
          data: {
            name: dto.name,
            description: dto.description,
            frequency: dto.frequency,
            isOptional: dto.isOptional,
            isCollectible: dto.isCollectible,
            order: dto.order,
          },
        });
      }
      return tx.feeCategory.create({
        data: {
          schoolId,
          name: dto.name,
          description: dto.description,
          frequency: dto.frequency,
          isOptional: dto.isOptional,
          isCollectible: dto.isCollectible,
          order: dto.order,
        },
      });
    });
  }

  /**
   * Archive, never delete. A category named on an issued bill has to keep
   * existing for that bill to render — and `FeeInvoiceLine` copies the name
   * and description anyway, so an archived category costs nothing.
   */
  async archiveCategory(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      const found = await tx.feeCategory.findFirst({ where: { id, schoolId } });
      if (!found) throw new ApiError('NOT_FOUND', 'Fee category not found', 404);
      return tx.feeCategory.update({ where: { id }, data: { archivedAt: new Date() } });
    });
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(schoolId: string, academicYearId: string) {
    return withTenant(schoolId, (tx) =>
      tx.feeTerm.findMany({
        where: { schoolId, academicYearId },
        orderBy: { order: 'asc' },
      }),
    );
  }

  /**
   * Whole-list replace, because "how many instalments" is one decision, not
   * four. Terms already carrying invoices are updated rather than dropped —
   * deleting one would orphan a bill a parent has seen.
   */
  async saveTerms(schoolId: string, dto: SaveTermsDto) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.feeTerm.findMany({
        where: { schoolId, academicYearId: dto.academicYearId },
      });
      const keep = new Set(dto.terms.map((t) => t.id).filter(Boolean) as string[]);

      const removable = existing.filter((t) => !keep.has(t.id));
      if (removable.length) {
        const used = await tx.feeInvoice.count({
          where: { schoolId, termId: { in: removable.map((t) => t.id) } },
        });
        if (used > 0) {
          throw new ApiError(
            'FEE_PLAN_FROZEN',
            'A term you are removing already has bills against it. Bills that have been issued cannot be unmade.',
            409,
          );
        }
        await tx.feeTerm.deleteMany({ where: { id: { in: removable.map((t) => t.id) } } });
      }

      for (const [i, t] of dto.terms.entries()) {
        const data = {
          schoolId,
          academicYearId: dto.academicYearId,
          name: t.name,
          dueDate: new Date(t.dueDate),
          order: i,
        };
        if (t.id) await tx.feeTerm.update({ where: { id: t.id }, data });
        else await tx.feeTerm.create({ data });
      }

      return tx.feeTerm.findMany({
        where: { schoolId, academicYearId: dto.academicYearId },
        orderBy: { order: 'asc' },
      });
    });
  }

  // ── The grid ──────────────────────────────────────────────────────────────

  /** The active plan for a year, created on first read so the screen never 404s. */
  async ensurePlan(tx: TenantTx, schoolId: string, academicYearId: string) {
    const active = await tx.feePlan.findFirst({
      where: { schoolId, academicYearId, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (active) return active;
    return tx.feePlan.create({ data: { schoolId, academicYearId, version: 1, isActive: true } });
  }

  /**
   * Everything step 3 needs in one call: grades down the side, categories
   * across the top, and the amounts already filled in. One round trip, because
   * the grid is useless half-loaded.
   */
  async getGrid(schoolId: string, academicYearId: string) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.ensurePlan(tx, schoolId, academicYearId);
      const [grades, categories, terms, items, invoiceCount] = await Promise.all([
        tx.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.feeCategory.findMany({
          where: { schoolId, archivedAt: null },
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
        }),
        tx.feeTerm.findMany({ where: { schoolId, academicYearId }, orderBy: { order: 'asc' } }),
        tx.feePlanItem.findMany({ where: { schoolId, planId: plan.id } }),
        tx.feeInvoice.count({ where: { schoolId, planId: plan.id } }),
      ]);

      // How many students sit in each grade — the footer row of the grid, and
      // the number a clerk checks their own spreadsheet against.
      const sections = await tx.classSection.findMany({
        where: { schoolId, academicYearId },
        select: { id: true, gradeId: true },
      });
      const counts = await tx.student.groupBy({
        by: ['classSectionId'],
        where: { schoolId, isActive: true, classSectionId: { in: sections.map((s) => s.id) } },
        _count: { _all: true },
      });
      const byGrade = new Map<string, number>();
      for (const c of counts) {
        const section = sections.find((s) => s.id === c.classSectionId);
        if (!section) continue;
        byGrade.set(section.gradeId, (byGrade.get(section.gradeId) ?? 0) + c._count._all);
      }

      return {
        planId: plan.id,
        planVersion: plan.version,
        /** True once bills exist: the screen switches to "editing makes a new version". */
        isFrozen: invoiceCount > 0,
        grades: grades.map((g) => ({ ...g, studentCount: byGrade.get(g.id) ?? 0 })),
        categories,
        terms,
        cells: items.map((i) => ({
          gradeId: i.gradeId,
          categoryId: i.categoryId,
          termId: i.termId,
          amountMinor: i.amountMinor,
        })),
      };
    });
  }

  /**
   * Save the whole grid.
   *
   * If bills already exist against the active plan, this mints a NEW plan
   * version instead of editing in place — which is what makes "a bill a parent
   * has seen never changes" true rather than aspirational. The old version
   * stays, the invoices keep pointing at it, and future billing uses the new one.
   */
  async saveGrid(schoolId: string, dto: SaveGridDto) {
    return withTenant(schoolId, async (tx) => {
      let plan = await this.ensurePlan(tx, schoolId, dto.academicYearId);

      const issued = await tx.feeInvoice.count({ where: { schoolId, planId: plan.id } });
      if (issued > 0) {
        const next = await tx.feePlan.aggregate({
          where: { schoolId, academicYearId: dto.academicYearId },
          _max: { version: true },
        });
        await tx.feePlan.update({ where: { id: plan.id }, data: { isActive: false } });
        plan = await tx.feePlan.create({
          data: {
            schoolId,
            academicYearId: dto.academicYearId,
            version: (next._max.version ?? 1) + 1,
            isActive: true,
          },
        });
        this.logger.log(
          { schoolId, planId: plan.id, version: plan.version, issued },
          'fee grid edited after billing — new plan version minted',
        );
      }

      // Whole-grid replace. Cheap (a few hundred rows at most) and it removes
      // an entire class of bug: a cell the clerk cleared cannot survive as a
      // stale row nobody can see any more.
      await tx.feePlanItem.deleteMany({ where: { schoolId, planId: plan.id } });

      const rows = dto.cells
        .filter((c) => c.amountMinor > 0)
        .map((c) => ({
          schoolId,
          planId: plan.id,
          gradeId: c.gradeId,
          categoryId: c.categoryId,
          termId: c.termId ?? null,
          amountMinor: c.amountMinor,
        }));
      if (rows.length) await tx.feePlanItem.createMany({ data: rows });

      return { planId: plan.id, planVersion: plan.version, cells: rows.length };
    });
  }

  // ── Exceptions ────────────────────────────────────────────────────────────

  async listConcessions(schoolId: string, studentId?: string) {
    return withTenant(schoolId, (tx) =>
      tx.feeConcession.findMany({
        where: { schoolId, ...(studentId ? { studentId } : {}) },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
          category: { select: { id: true, name: true } },
          term: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async saveConcession(schoolId: string, actorId: string, dto: SaveConcessionDto) {
    // Also a DB check constraint. Enforced here too so the parent-facing error
    // is a sentence rather than a Postgres violation.
    const hasPct = dto.percentBps != null;
    const hasAmt = dto.amountMinor != null;
    if (hasPct === hasAmt) {
      throw new ApiError(
        'CONCESSION_BASIS',
        'A concession must be either a percentage or a fixed amount — not both, and not neither.',
        400,
      );
    }

    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: dto.studentId, schoolId } });
      if (!student) throw new ApiError('NOT_FOUND', 'Student not found', 404);

      return tx.feeConcession.create({
        data: {
          schoolId,
          studentId: dto.studentId,
          categoryId: dto.categoryId ?? null,
          termId: dto.termId ?? null,
          percentBps: dto.percentBps ?? null,
          amountMinor: dto.amountMinor ?? null,
          reason: dto.reason,
          createdBy: actorId,
        },
      });
    });
  }

  async deleteConcession(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      const found = await tx.feeConcession.findFirst({ where: { id, schoolId } });
      if (!found) throw new ApiError('NOT_FOUND', 'Concession not found', 404);
      await tx.feeConcession.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
