import { Injectable } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import {
  applyGradeOverrides, gradeFixedAmounts, resolveEarnings, structureOvershoot, wageShareShortfall,
  type ComponentDef, type GradeOverride,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService, readGradeOverrides } from './pay-people.service';
import type { RaiseGradeDto, UpsertGradeDto } from './payroll.dto';


export interface GradeRow {
  id: string;
  name: string;
  description: string | null;
  bandMinMinor: number;
  bandMaxMinor: number;
  overrides: Record<string, GradeOverride>;
  order: number;
  active: boolean;
  note: string | null;
  /** How many people are on this grade today, and what they cost a month. */
  headcount: number;
  monthlyMinor: number;
  /** The split at the middle of the band, so the screen can draw it to scale. */
  split: { key: string; name: string; amountMinor: number }[];
  /** Set when this grade's split breaks the wage-share rule — once, here, for everyone on it. */
  wageShareNote: string | null;
  /** More than zero when the split's parts add to more than the pay itself. */
  overshootMinor: number;
}

/**
 * GRADES — a job's pay.
 *
 * The reason this exists: a school does not set 48 salaries, it sets six and
 * points people at them. Every compliance check that used to run per person
 * (the Code on Wages 50% rule) now runs per grade, so a school can be wrong in
 * six places instead of forty-eight — and can be put right in six.
 */
@Injectable()
export class PayGradesService {
  constructor(
    private readonly packs: PayPackService,
    private readonly people: PayPeopleService,
  ) {}

  /** The school's component list as the engine wants it. */
  private async defs(schoolId: string): Promise<ComponentDef[]> {
    const comps = await this.people.components(schoolId);
    return comps.map((c) => ({
      key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? undefined,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }));
  }

  /**
   * What a grade actually pays at a given gross — the bar the Grades screen
   * draws, and the wage-share check, in one place so they can never disagree.
   */
  async resolve(schoolId: string, overrides: Record<string, GradeOverride>, grossMinor: number, onISO: string) {
    const { pack } = await this.packs.forSchool(schoolId);
    const defs = applyGradeOverrides(await this.defs(schoolId), overrides);
    const lines = resolveEarnings(defs, {
      monthlyGrossMinor: grossMinor,
      fixed: gradeFixedAmounts(overrides),
    });
    return {
      lines,
      wageShare: wageShareShortfall(lines, pack, onISO),
      overshootMinor: structureOvershoot(lines, grossMinor),
    };
  }

  async list(schoolId: string, onISO: string): Promise<GradeRow[]> {
    const { pack } = await this.packs.forSchool(schoolId);
    const baseDefs = await this.defs(schoolId);

    const { grades, counts } = await withTenant(schoolId, async (tx) => {
      const grades = await tx.payGrade.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      });
      const on = new Date(`${onISO}T00:00:00.000Z`);
      // Only the row in force today counts, so a superseded structure from a
      // previous grade does not inflate the grade it used to be on.
      const pays = await tx.employeePay.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, effectiveFrom: { lte: on } },
        orderBy: { effectiveFrom: 'desc' },
        select: { teacherId: true, staffId: true, payGradeId: true, monthlyGrossMinor: true },
      });
      const seen = new Set<string>();
      const counts = new Map<string, { n: number; minor: number }>();
      for (const p of pays) {
        const person = p.teacherId ?? p.staffId!;
        if (seen.has(person)) continue;
        seen.add(person);
        if (!p.payGradeId) continue;
        const cur = counts.get(p.payGradeId) ?? { n: 0, minor: 0 };
        counts.set(p.payGradeId, { n: cur.n + 1, minor: cur.minor + p.monthlyGrossMinor });
      }
      return { grades, counts };
    });

    return grades.map((g) => {
      const overrides = readGradeOverrides(g.overrides);
      // Drawn at the middle of the band: the split is proportional, so any
      // point in the band gives the same shape, and the middle is the one a
      // reader can check against the band bar above it.
      const mid = g.bandMaxMinor > 0 ? Math.round((g.bandMinMinor + g.bandMaxMinor) / 2) : g.bandMinMinor;
      const lines = resolveEarnings(applyGradeOverrides(baseDefs, overrides), {
        monthlyGrossMinor: mid, fixed: gradeFixedAmounts(overrides),
      });
      const short = wageShareShortfall(lines, pack, onISO);
      const over = structureOvershoot(lines, mid);
      const c = counts.get(g.id) ?? { n: 0, minor: 0 };
      return {
        id: g.id, name: g.name, description: g.description,
        bandMinMinor: g.bandMinMinor, bandMaxMinor: g.bandMaxMinor,
        overrides, order: g.order, active: g.active, note: g.note,
        headcount: c.n, monthlyMinor: c.minor,
        split: lines.map((l) => ({ key: l.key, name: l.name, amountMinor: l.amountMinor })),
        wageShareNote: short ? short.note : null,
        overshootMinor: over,
      };
    });
  }

  async upsert(schoolId: string, actorId: string, dto: UpsertGradeDto) {
    if (dto.bandMaxMinor > 0 && dto.bandMaxMinor < dto.bandMinMinor) {
      throw new ApiError('VALIDATION', 'The top of the band cannot be below the bottom.', 400, 'bandMaxMinor');
    }
    const overrides = readGradeOverrides(dto.overrides ?? {});

    // Checked at the TOP of the band: the split is proportional, so if the
    // largest figure on this grade fits, every smaller one does too.
    const at = dto.bandMaxMinor > 0 ? dto.bandMaxMinor : dto.bandMinMinor;
    if (at > 0) {
      const { overshootMinor } = await this.resolve(schoolId, overrides, at, new Date().toISOString().slice(0, 10));
      if (overshootMinor > 0) {
        throw new ApiError(
          'SALARY_OVERSHOOT',
          `That split adds up to more than the pay itself — ₹${Math.round(overshootMinor / 100).toLocaleString('en-IN')} a month over, at the top of the band. Lower Basic's share.`,
          400,
          'overrides',
        );
      }
    }

    return withTenant(schoolId, async (tx) => {
      const data = {
        name: dto.name.trim(), description: dto.description?.trim() || null,
        bandMinMinor: dto.bandMinMinor, bandMaxMinor: dto.bandMaxMinor,
        overrides: overrides as unknown as Prisma.InputJsonValue,
        order: dto.order ?? 50, active: dto.active ?? true,
        note: dto.note?.trim() || null,
      };
      if (dto.id) {
        const found = await tx.payGrade.findFirst({ where: { id: dto.id, schoolId }, select: { id: true } });
        if (!found) throw new ApiError('NOT_FOUND', 'That grade is not on this school’s list.', 404, 'id');
        return tx.payGrade.update({ where: { id: dto.id }, data, select: { id: true } });
      }
      const clash = await tx.payGrade.findFirst({ where: { schoolId, name: data.name }, select: { id: true } });
      if (clash) throw new ApiError('VALIDATION', `There is already a grade called ${data.name}.`, 400, 'name');
      return tx.payGrade.create({ data: { schoolId, ...data, createdById: actorId }, select: { id: true } });
    });
  }

  /**
   * Remove a grade.
   *
   * Refused while anyone is on it. The foreign key would set their `payGradeId`
   * to null and leave the money untouched, so nothing would break — but a
   * grade quietly emptying itself is precisely the kind of change a payroll
   * must never make on its own.
   */
  async remove(schoolId: string, id: string, onISO: string) {
    const rows = await this.list(schoolId, onISO);
    const g = rows.find((r) => r.id === id);
    if (!g) throw new ApiError('NOT_FOUND', 'That grade is not on this school’s list.', 404, 'id');
    if (g.headcount > 0) {
      throw new ApiError(
        'VALIDATION',
        `${g.headcount} ${g.headcount === 1 ? 'person is' : 'people are'} on ${g.name}. Move them to another grade first.`,
        400,
        'id',
      );
    }
    await withTenant(schoolId, (tx) => tx.payGrade.delete({ where: { id } }));
    return { ok: true };
  }

  /**
   * Draft a school's grades from the roll it already has.
   *
   * The difference between a blank room and a room half-built for you. Nothing
   * is saved: these are proposals the admin edits and accepts, and any band we
   * suggest is taken from what the school ALREADY pays where we know it, so a
   * school that has set some pay sees its own figures rather than ours.
   */
  async suggest(schoolId: string, onISO: string) {
    const [existing, people] = await Promise.all([
      this.list(schoolId, onISO),
      this.people.people(schoolId, onISO),
    ]);
    const taken = new Set(existing.map((g) => g.name.toLowerCase()));

    const buckets = new Map<string, { name: string; description: string; pays: number[]; n: number }>();
    for (const p of people) {
      const label = p.designation ?? (p.personKind === 'TEACHER' ? 'Teacher' : 'Staff');
      const key = label.toLowerCase();
      const b = buckets.get(key) ?? { name: SHORT_NAME[label] ?? label, description: label, pays: [], n: 0 };
      b.n += 1;
      if (p.pay) b.pays.push(p.pay.monthlyGrossMinor);
      buckets.set(key, b);
    }

    let order = existing.length * 10;
    return [...buckets.values()]
      .filter((b) => !taken.has(b.name.toLowerCase()))
      .sort((a, b) => b.n - a.n)
      .map((b) => {
        const known = b.pays.length ? b.pays : null;
        const min = known ? Math.min(...known) : 0;
        const max = known ? Math.max(...known) : 0;
        order += 10;
        return {
          name: b.name,
          description: b.description,
          // A band of one figure is not a band. Widen a single known salary by
          // a fifth each way so it can hold the next person without an edit.
          bandMinMinor: known ? Math.round(min * 0.8) : 0,
          bandMaxMinor: known ? Math.round(max * 1.2) : 0,
          order,
          headcount: b.n,
          onPay: b.pays.length,
        };
      });
  }

  /**
   * Raise a whole grade at once.
   *
   * The April job. Everyone on the grade gets a NEW pay row from one date —
   * the structure is never edited in place, so the increment is backdatable
   * and the run works out the arrears by itself.
   */
  async raise(schoolId: string, actorId: string, dto: RaiseGradeDto) {
    if (dto.percentBps == null && dto.flatMinor == null) {
      throw new ApiError('VALIDATION', 'Say how much to raise the grade by.', 400, 'percentBps');
    }
    const { pack } = await this.packs.forSchool(schoolId);
    const baseDefs = await this.defs(schoolId);

    return withTenant(schoolId, async (tx) => {
      const grade = await tx.payGrade.findFirst({ where: { id: dto.gradeId, schoolId } });
      if (!grade) throw new ApiError('NOT_FOUND', 'That grade is not on this school’s list.', 404, 'gradeId');
      const overrides = readGradeOverrides(grade.overrides);

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      const current = await this.currentRows(tx, schoolId, from);
      const mine = current.filter((p) => p.payGradeId === dto.gradeId);
      if (mine.length === 0) {
        throw new ApiError('VALIDATION', `Nobody is on ${grade.name} yet.`, 400, 'gradeId');
      }

      const raised = mine.map((p) => {
        const next = dto.percentBps != null
          ? Math.round(p.monthlyGrossMinor * (1 + dto.percentBps / 10_000))
          : p.monthlyGrossMinor + (dto.flatMinor ?? 0);
        // Whole rupees: a payslip that prints paise on a salary reads as an error.
        return { row: p, nextMinor: Math.max(0, Math.round(next / 100) * 100) };
      });

      // One wage-share check for the grade, at the largest new figure — the
      // split is proportional, so if the top of the grade passes, all of it does.
      const top = Math.max(...raised.map((r) => r.nextMinor));
      const lines = resolveEarnings(applyGradeOverrides(baseDefs, overrides), {
        monthlyGrossMinor: top, fixed: gradeFixedAmounts(overrides),
      });
      const short = wageShareShortfall(lines, pack, dto.effectiveFrom);
      if (short && !dto.acceptWageShare) {
        throw new ApiError(
          'SALARY_WAGE_SHARE',
          `Basic would be too small a share of this grade's pay. ${short.note}`,
          400,
          'gradeId',
        );
      }

      await tx.employeePay.createMany({
        data: raised.map(({ row, nextMinor }) => ({
          schoolId,
          personKind: row.personKind,
          teacherId: row.teacherId,
          staffId: row.staffId,
          payGradeId: dto.gradeId,
          effectiveFrom: from,
          monthlyGrossMinor: nextMinor,
          fixedAmounts: row.fixedAmounts as Prisma.InputJsonValue,
          taxRegime: row.taxRegime,
          pfOptIn: row.pfOptIn,
          pfOnActual: row.pfOnActual,
          esiExempt: row.esiExempt,
          localTaxExempt: row.localTaxExempt,
          paidThroughVacation: row.paidThroughVacation,
          contractMonths: row.contractMonths,
          fixedTerm: row.fixedTerm,
          joinedOn: row.joinedOn,
          pan: row.pan, uan: row.uan, esiNumber: row.esiNumber,
          bankAccount: row.bankAccount, bankIfsc: row.bankIfsc, bankName: row.bankName,
          note: dto.note ?? `Grade raise · ${grade.name}`,
          createdById: actorId,
        })),
      });

      const before = raised.reduce((a, r) => a + r.row.monthlyGrossMinor, 0);
      const after = raised.reduce((a, r) => a + r.nextMinor, 0);
      return { grade: grade.name, moved: raised.length, beforeMinor: before, afterMinor: after };
    });
  }

  /**
   * Put people on a grade in one go — the "3 people are not on a grade" fix.
   *
   * Each person still gets their own pay row, because each has their own
   * figure; what the grade supplies is everything else, which is why this can
   * be one action instead of one form per person.
   */
  async assign(schoolId: string, actorId: string, gradeId: string, effectiveFrom: string,
               rows: { personKind: 'TEACHER' | 'STAFF'; personId: string; monthlyGrossMinor: number }[]) {
    if (rows.length === 0) throw new ApiError('VALIDATION', 'Nobody was selected.', 400, 'rows');

    return withTenant(schoolId, async (tx) => {
      const grade = await tx.payGrade.findFirst({ where: { id: gradeId, schoolId } });
      if (!grade) throw new ApiError('NOT_FOUND', 'That grade is not on this school’s list.', 404, 'gradeId');

      const [teachers, staff] = await Promise.all([
        tx.teacher.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, id: { in: rows.filter((r) => r.personKind === 'TEACHER').map((r) => r.personId) } },
          select: { id: true },
        }),
        tx.staff.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, id: { in: rows.filter((r) => r.personKind === 'STAFF').map((r) => r.personId) } },
          select: { id: true },
        }),
      ]);
      // A client-supplied id is checked against THIS school's roll: an FK alone
      // would not, because referential integrity bypasses row-level security.
      const ok = new Set([...teachers.map((t) => t.id), ...staff.map((s) => s.id)]);
      const stray = rows.find((r) => !ok.has(r.personId));
      if (stray) throw new ApiError('NOT_FOUND', 'Someone on that list is not on this school’s roll.', 404, 'rows');

      await tx.employeePay.createMany({
        data: rows.map((r) => ({
          schoolId,
          personKind: r.personKind,
          teacherId: r.personKind === 'TEACHER' ? r.personId : null,
          staffId: r.personKind === 'STAFF' ? r.personId : null,
          payGradeId: gradeId,
          effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
          monthlyGrossMinor: Math.max(0, Math.round(r.monthlyGrossMinor / 100) * 100),
          fixedAmounts: {},
          note: `Put on ${grade.name}`,
          createdById: actorId,
        })),
      });
      return { grade: grade.name, moved: rows.length };
    });
  }

  /** The pay row in force on a date, one per person. */
  private async currentRows(tx: TenantTx, schoolId: string, on: Date) {
    const pays = await tx.employeePay.findMany({
      take: LIST_CEILING.ROSTER,
      where: { schoolId, effectiveFrom: { lte: on } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const latest = new Map<string, (typeof pays)[number]>();
    for (const p of pays) {
      const key = p.teacherId ?? p.staffId!;
      if (!latest.has(key)) latest.set(key, p);
    }
    return [...latest.values()];
  }
}

/** What a school calls the job on a payslip, shortened to what it says out loud. */
const SHORT_NAME: Record<string, string> = {
  'Office staff': 'Office',
  'Support staff': 'Support',
  'Sports teacher': 'Sports',
};
