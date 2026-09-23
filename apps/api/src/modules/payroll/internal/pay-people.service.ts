import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import {
  applyGradeOverrides, gradeFixedAmounts, resolveEarnings, structureOvershoot, wageShareShortfall,
  type ComponentDef, type GradeOverride, type PayPack, type StandardComponent,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';
import type { SetStructureDto, UpsertComponentDto } from './payroll.dto';

export interface PersonRow {
  personKind: 'TEACHER' | 'STAFF';
  id: string;
  name: string;
  designation: string | null;
  userId: string | null;
  /** The structure in force today, if any. */
  pay: {
    id: string;
    effectiveFrom: string;
    monthlyGrossMinor: number;
    payGradeId: string | null;
    taxRegime: 'NEW' | 'OLD';
    pfOptIn: boolean;
    paidThroughVacation: boolean;
    contractMonths: number;
    /** Whether the person can actually be paid — the bank-account exception. */
    hasBank: boolean;
  } | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The overrides column, read back out of Json without trusting its shape. */
export function readGradeOverrides(raw: unknown): Record<string, GradeOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, GradeOverride> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as { rateBps?: unknown; fixedMinor?: unknown };
    const o: GradeOverride = {};
    if (typeof v.rateBps === 'number') o.rateBps = v.rateBps;
    if (typeof v.fixedMinor === 'number') o.fixedMinor = v.fixedMinor;
    if (o.rateBps != null || o.fixedMinor != null) out[key] = o;
  }
  return out;
}
const nameOf = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/**
 * PEOPLE — who is on the payroll, and what each one is paid.
 *
 * The one rule that makes the whole module work: a structure is never edited
 * in place. A raise writes a new row with the date it starts from, and the
 * engine picks the row in force for the month it is computing. That is what
 * makes a backdated April increment, told to us in October, a computation
 * rather than a spreadsheet job.
 */
@Injectable()
export class PayPeopleService {
  constructor(private readonly packs: PayPackService) {}

  /** The school's component list, seeded from the country pack on first use. */
  async components(schoolId: string) {
    const { pack } = await this.packs.forSchool(schoolId);
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.payComponent.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      });
      if (rows.length) return rows;
      await this.seed(tx, schoolId, pack.standardComponents);
      return tx.payComponent.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      });
    });
  }

  private async seed(tx: TenantTx, schoolId: string, standard: readonly StandardComponent[]) {
    await tx.payComponent.createMany({
      data: standard.map((c) => ({
        schoolId, key: c.key, name: c.name, kind: c.kind, calc: c.calc,
        rateBps: c.rateBps ?? null, taxable: c.taxable, isWages: c.isWages,
        retirementBase: c.retirementBase, healthBase: c.healthBase,
        gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order, hint: c.hint ?? null,
      })),
      skipDuplicates: true,
    });
  }

  async upsertComponent(schoolId: string, dto: UpsertComponentDto) {
    if (dto.calc !== 'FIXED' && dto.calc !== 'BALANCE' && dto.rateBps == null) {
      throw new ApiError('VALIDATION', 'A percentage component needs a percentage.', 400, 'rateBps');
    }
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.payComponent.findFirst({ where: { schoolId, key: dto.key }, select: { id: true } });
      const data = {
        name: dto.name, kind: dto.kind, calc: dto.calc, rateBps: dto.rateBps ?? null,
        taxable: dto.taxable ?? true, isWages: dto.isWages ?? false,
        retirementBase: dto.retirementBase ?? false, healthBase: dto.healthBase ?? true,
        gratuityBase: dto.gratuityBase ?? false, prorate: dto.prorate ?? true,
        order: dto.order ?? 50, active: dto.active ?? true, hint: dto.hint ?? null,
      };
      if (existing) return tx.payComponent.update({ where: { id: existing.id }, data, select: { id: true } });
      return tx.payComponent.create({ data: { schoolId, key: dto.key, ...data }, select: { id: true } });
    });
  }

  /** Everyone who could be on the payroll, with the structure in force today. */
  async people(schoolId: string, onISO: string): Promise<PersonRow[]> {
    return withTenant(schoolId, async (tx) => {
      const on = new Date(`${onISO}T00:00:00.000Z`);
      const [teachers, staff] = await Promise.all([
        tx.teacher.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, isActive: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          // Teacher carries no job title — `primarySubjectId` is the nearest
          // thing, and "Teacher" is what a payslip prints anyway.
          select: { id: true, firstName: true, lastName: true, userId: true },
        }),
        tx.staff.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, isActive: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          select: { id: true, firstName: true, lastName: true, userId: true, role: true },
        }),
      ]);
      const pays = await tx.employeePay.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, effectiveFrom: { lte: on } },
        orderBy: { effectiveFrom: 'desc' },
      });
      // Newest row at or before the date wins, per person.
      const latest = new Map<string, (typeof pays)[number]>();
      for (const p of pays) {
        const key = p.teacherId ?? p.staffId!;
        if (!latest.has(key)) latest.set(key, p);
      }
      const shape = (p: (typeof pays)[number] | undefined) =>
        p ? {
          id: p.id, effectiveFrom: iso(p.effectiveFrom), monthlyGrossMinor: p.monthlyGrossMinor,
          payGradeId: p.payGradeId,
          taxRegime: p.taxRegime as 'NEW' | 'OLD', pfOptIn: p.pfOptIn,
          paidThroughVacation: p.paidThroughVacation, contractMonths: p.contractMonths,
          hasBank: !!p.bankAccount,
        } : null;

      return [
        ...teachers.map((t) => ({
          personKind: 'TEACHER' as const, id: t.id, name: nameOf(t),
          designation: 'Teacher', userId: t.userId, pay: shape(latest.get(t.id)),
        })),
        ...staff.map((s) => ({
          personKind: 'STAFF' as const, id: s.id, name: nameOf(s),
          designation: STAFF_LABEL[s.role] ?? 'Staff', userId: s.userId, pay: shape(latest.get(s.id)),
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /** Every structure this person has ever had, newest first — the raise history. */
  async history(schoolId: string, personKind: 'TEACHER' | 'STAFF', personId: string) {
    return withTenant(schoolId, (tx) =>
      tx.employeePay.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, ...(personKind === 'TEACHER' ? { teacherId: personId } : { staffId: personId }) },
        orderBy: { effectiveFrom: 'desc' },
      }),
    );
  }

  /**
   * Set (or change) a person's pay, FROM a date.
   *
   * Refuses a structure that breaks the Code on Wages 50% rule, and says how
   * much has to move into Basic rather than just saying no — the rule is new
   * enough (21 November 2025) that most schools have never met it.
   */
  async setStructure(schoolId: string, actorId: string, dto: SetStructureDto) {
    const { pack } = await this.packs.forSchool(schoolId);
    const comps = await this.components(schoolId);
    const defs: ComponentDef[] = comps.map((c) => ({
      key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? undefined,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }));
    const grade = await this.gradeOverrides(schoolId, dto.payGradeId);
    const lines = resolveEarnings(applyGradeOverrides(defs, grade), {
      monthlyGrossMinor: dto.monthlyGrossMinor,
      fixed: { ...gradeFixedAmounts(grade), ...(dto.fixedAmounts ?? {}) },
    });
    // Refused, not warned: the wage-share rule is a policy a school may choose
    // to take the risk on, but a split that pays MORE than the figure agreed
    // is arithmetic, and no school ever means it.
    const over = structureOvershoot(lines, dto.monthlyGrossMinor);
    if (over > 0) {
      throw new ApiError(
        'SALARY_OVERSHOOT',
        `This split adds up to ₹${Math.round(over / 100).toLocaleString('en-IN')} a month MORE than the pay you have agreed. Lower Basic's share on the grade, or raise the pay.`,
        400,
        'payGradeId',
      );
    }

    const short = wageShareShortfall(lines, pack, dto.effectiveFrom);
    if (short && !dto.acceptWageShare) {
      throw new ApiError(
        'SALARY_WAGE_SHARE',
        `Basic is too small a share of this pay. Move ₹${Math.round(short.shortfallMinor / 100).toLocaleString('en-IN')} a month into Basic, or record that you are taking the risk. ${short.note}`,
        400,
        'monthlyGrossMinor',
      );
    }
    return withTenant(schoolId, async (tx) => {
      await this.requirePerson(tx, schoolId, dto.personKind, dto.personId);
      return tx.employeePay.create({
        data: {
          schoolId,
          personKind: dto.personKind,
          teacherId: dto.personKind === 'TEACHER' ? dto.personId : null,
          staffId: dto.personKind === 'STAFF' ? dto.personId : null,
          effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00.000Z`),
          monthlyGrossMinor: dto.monthlyGrossMinor,
          payGradeId: dto.payGradeId ?? null,
          fixedAmounts: dto.fixedAmounts ?? {},
          taxRegime: dto.taxRegime ?? 'NEW',
          pfOptIn: dto.pfOptIn ?? true,
          pfOnActual: dto.pfOnActual ?? false,
          esiExempt: dto.esiExempt ?? false,
          localTaxExempt: dto.localTaxExempt ?? false,
          paidThroughVacation: dto.paidThroughVacation ?? true,
          contractMonths: dto.contractMonths ?? 12,
          fixedTerm: dto.fixedTerm ?? false,
          joinedOn: dto.joinedOn ? new Date(`${dto.joinedOn}T00:00:00.000Z`) : null,
          pan: dto.pan ?? null, uan: dto.uan ?? null, esiNumber: dto.esiNumber ?? null,
          bankAccount: dto.bankAccount ?? null, bankIfsc: dto.bankIfsc ?? null, bankName: dto.bankName ?? null,
          note: dto.note ?? null,
          createdById: actorId,
        },
        select: { id: true },
      });
    });
  }

  /** What a structure would actually pay, without saving it — the preview the screen draws. */
  async preview(schoolId: string, dto: { monthlyGrossMinor: number; fixedAmounts?: Record<string, number>; payGradeId?: string; onISO: string }) {
    const { pack } = await this.packs.forSchool(schoolId);
    const comps = await this.components(schoolId);
    const defs: ComponentDef[] = comps.map((c) => ({
      key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? undefined,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }));
    const grade = await this.gradeOverrides(schoolId, dto.payGradeId);
    const lines = resolveEarnings(applyGradeOverrides(defs, grade), {
      monthlyGrossMinor: dto.monthlyGrossMinor,
      fixed: { ...gradeFixedAmounts(grade), ...(dto.fixedAmounts ?? {}) },
    });
    return {
      lines,
      wageShare: wageShareShortfall(lines, pack, dto.onISO),
      overshootMinor: structureOvershoot(lines, dto.monthlyGrossMinor),
    };
  }

  /**
   * A grade's split, or an empty one.
   *
   * Empty is the common case AND the safe default: the shipped components
   * already satisfy the wage-share rule, so a person with no grade is costed
   * exactly as they were before grades existed.
   */
  private async gradeOverrides(schoolId: string, gradeId: string | undefined): Promise<Record<string, GradeOverride>> {
    if (!gradeId) return {};
    const g = await withTenant(schoolId, (tx) =>
      tx.payGrade.findFirst({ where: { id: gradeId, schoolId }, select: { overrides: true } }));
    if (!g) throw new ApiError('NOT_FOUND', 'That grade is not on this school’s list.', 404, 'payGradeId');
    return readGradeOverrides(g.overrides);
  }

  private async requirePerson(tx: TenantTx, schoolId: string, kind: 'TEACHER' | 'STAFF', id: string) {
    const found = kind === 'TEACHER'
      ? await tx.teacher.findFirst({ where: { id, schoolId }, select: { id: true } })
      : await tx.staff.findFirst({ where: { id, schoolId }, select: { id: true } });
    if (!found) throw new ApiError('NOT_FOUND', 'That person is not on this school’s roll.', 404, 'personId');
  }
}

const STAFF_LABEL: Record<string, string> = {
  OFFICE: 'Office staff', SUPPORT: 'Support staff', DRIVER: 'Driver', HELPER: 'Helper',
  SECURITY: 'Security', LIBRARIAN: 'Librarian', SPORTS: 'Sports teacher', OTHER: 'Staff',
};

export type { PayPack };
