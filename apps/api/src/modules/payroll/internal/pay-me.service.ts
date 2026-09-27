import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { taxYearLabel, taxYearOf } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';
import type { SaveDeclarationDto } from './payroll.dto';

/**
 * MY PAY — the half of the module a teacher actually opens, on the last day
 * of the month, for exactly one reason.
 *
 * It answers only about the caller, resolved from their own user id, and it
 * shows only LOCKED months: a draft figure in a teacher's hand is a
 * conversation the office cannot win.
 *
 * The one line most payslips leave out is here on purpose — what the school
 * paid in on top. A teacher who has never been shown the provident fund the
 * school contributes reads the payslip as smaller than the job; showing it is
 * the cheapest honesty in the product.
 */
@Injectable()
export class PayMeService {
  constructor(private readonly packs: PayPackService) {}

  private async who(tx: TenantTx, schoolId: string, userId: string) {
    const [teacher, staff] = await Promise.all([
      tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } }),
      tx.staff.findFirst({ where: { schoolId, userId }, select: { id: true } }),
    ]);
    if (teacher) return { kind: 'TEACHER' as const, id: teacher.id, where: { teacherId: teacher.id } };
    if (staff) return { kind: 'STAFF' as const, id: staff.id, where: { staffId: staff.id } };
    throw new ApiError('NOT_FOUND', 'Your school record is not linked to this login yet — ask the office.', 404);
  }

  async mine(schoolId: string, userId: string) {
    const { pack, currency } = await this.packs.forSchool(schoolId);
    return withTenant(schoolId, async (tx) => {
      const me = await this.who(tx, schoolId, userId);
      const slips = await tx.payslip.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, ...me.where, payRun: { status: { in: ['LOCKED', 'PAID'] } } },
        orderBy: [{ payRun: { periodYear: 'desc' } }, { payRun: { periodMonth: 'desc' } }],
        select: {
          id: true, name: true, designation: true, lines: true, daysInMonth: true, daysPaid: true,
          grossMinor: true, deductionMinor: true, netMinor: true, employerCostMinor: true,
          incomeTaxMinor: true, ytdGrossMinor: true, ytdTaxMinor: true, taxRegime: true,
          payRun: { select: { periodYear: true, periodMonth: true, status: true, paidAt: true } },
        },
      });
      const latest = slips[0] ?? null;
      const ty = latest
        ? taxYearOf(pack, latest.payRun.periodYear, latest.payRun.periodMonth)
        : taxYearOf(pack, new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
      const declaration = await tx.taxDeclaration.findFirst({
        where: { schoolId, ...me.where, taxYear: ty.taxYear },
      });
      return {
        currency,
        personKind: me.kind,
        taxYear: ty.taxYear,
        taxYearLabel: taxYearLabel(pack, ty.taxYear),
        /** Which parts of a declaration this regime actually uses — the screen says so rather than collecting dead data. */
        regimes: pack.regimes.map((r) => ({ key: r.key, label: r.label, allows: r.allows })),
        defaultRegime: pack.defaultRegime,
        declaration,
        payslips: slips,
        /** Nothing locked yet is not an error — it is a school that has not run pay. */
        empty: slips.length === 0,
      };
    });
  }

  async payslip(schoolId: string, userId: string, payslipId: string) {
    return withTenant(schoolId, async (tx) => {
      const me = await this.who(tx, schoolId, userId);
      const slip = await tx.payslip.findFirst({
        where: { id: payslipId, schoolId, ...me.where, payRun: { status: { in: ['LOCKED', 'PAID'] } } },
        include: { payRun: { select: { periodYear: true, periodMonth: true, paidAt: true, packVersion: true, rulesAsAt: true } } },
      });
      if (!slip) throw new ApiError('NOT_FOUND', 'No payslip for that month.', 404);
      return slip;
    });
  }

  /**
   * The declaration — Form 124 in India since April 2026, formerly Form 12BB.
   * Saving it re-trues the tax on the NEXT run, never a locked one.
   */
  async saveDeclaration(schoolId: string, userId: string, dto: SaveDeclarationDto) {
    const { pack } = await this.packs.forSchool(schoolId);
    return withTenant(schoolId, async (tx) => {
      const me = await this.who(tx, schoolId, userId);
      const data = {
        regime: dto.regime ?? pack.defaultRegime,
        rentAnnualMinor: dto.rentAnnualMinor ?? 0,
        metro: dto.metro ?? false,
        landlordPan: dto.landlordPan ?? null,
        section80cMinor: dto.section80cMinor ?? 0,
        section80dMinor: dto.section80dMinor ?? 0,
        homeLoanInterestMinor: dto.homeLoanInterestMinor ?? 0,
        otherIncomeMinor: dto.otherIncomeMinor ?? 0,
        previousEmployerSalaryMinor: dto.previousEmployerSalaryMinor ?? 0,
        previousEmployerTdsMinor: dto.previousEmployerTdsMinor ?? 0,
        status: dto.submit ? ('SUBMITTED' as const) : ('DRAFT' as const),
        submittedAt: dto.submit ? new Date() : null,
      };
      const existing = await tx.taxDeclaration.findFirst({
        where: { schoolId, ...me.where, taxYear: dto.taxYear }, select: { id: true },
      });
      if (existing) return tx.taxDeclaration.update({ where: { id: existing.id }, data, select: { id: true, status: true } });
      return tx.taxDeclaration.create({
        data: {
          schoolId, personKind: me.kind,
          teacherId: me.kind === 'TEACHER' ? me.id : null,
          staffId: me.kind === 'STAFF' ? me.id : null,
          taxYear: dto.taxYear, ...data,
        },
        select: { id: true, status: true },
      });
    });
  }

  /** My own person key, for the annual statement route. */
  async identify(schoolId: string, userId: string) {
    return withTenant(schoolId, (tx) => this.who(tx, schoolId, userId));
  }
}
