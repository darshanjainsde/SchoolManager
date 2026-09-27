import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { asOf, type PayPack } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { PayPackService } from './pay-pack.service';

const rupees = (minor: number) => (minor / 100).toFixed(2);
const whole = (minor: number) => String(Math.round(minor / 100));
const clean = (s: string | null | undefined) => (s ?? '').replace(/[#~|\r\n]/g, ' ').trim();

/**
 * THE FILES — and only the files.
 *
 * The module computes what is owed and produces the exact text a portal
 * expects, and it never submits anything on a school's behalf. That line is
 * drawn deliberately: submitting carries a liability that belongs to the
 * school and its accountant, and a product that files wrongly on somebody
 * else's registration is a different and much worse business to be in.
 *
 * Everything below is generated from a LOCKED run, never a draft, because a
 * file that disagrees with the payslips it came from is worse than no file.
 */
@Injectable()
export class PayStatutoryService {
  constructor(private readonly packs: PayPackService) {}

  /** What is due, when, for the month just run — the compliance calendar. */
  async calendar(schoolId: string, year: number, month: number) {
    const { pack } = await this.packs.forSchool(schoolId);
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const due = (day: number, y = next.y, m = next.m) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
      rulesAsAt: pack.rulesAsAt,
      packVersion: pack.version,
      period: { year, month },
      duties: pack.filings.map((f) => {
        if (f.cadence === 'MONTHLY') return { ...f, dueOn: due(f.dueDay ?? 15) };
        if (f.cadence === 'QUARTERLY') {
          const m = (f.dueMonths ?? []).find((x) => x >= next.m) ?? (f.dueMonths ?? [])[0] ?? next.m;
          return { ...f, dueOn: due(f.dueDay ?? 31, m >= next.m ? next.y : next.y + 1, m) };
        }
        if (f.cadence === 'ANNUAL') {
          const m = (f.dueMonths ?? [6])[0];
          return { ...f, dueOn: due(f.dueDay ?? 30, m >= next.m ? next.y : next.y + 1, m) };
        }
        return { ...f, dueOn: null };
      }),
      /** Said out loud rather than buried: we compute and hand you the file. */
      note: 'Sckools works out what is owed and makes the file to upload. Submitting it stays with your school and its accountant.',
      unverified: pack.unverified,
    };
  }

  /**
   * The provident-fund return, one line per member.
   *
   * Format is the EPFO's own electronic challan-cum-return: `#~#`-separated,
   * whole rupees, one line per member. A school uploads it as it is.
   */
  async retirementFile(schoolId: string, runId: string): Promise<{ filename: string; body: string }> {
    const { run, slips, pay } = await this.locked(schoolId, runId);
    const lines = slips
      .filter((s) => s.retirementEmployeeMinor > 0)
      .map((s) => {
        const p = pay.get(s.teacherId ?? s.staffId ?? '');
        const wages = s.retirementEmployeeMinor > 0 ? Math.round((s.retirementEmployeeMinor / 12) * 100) : 0;
        return [
          clean(p?.uan) || '000000000000',
          clean(s.name),
          whole(wages), whole(wages), whole(wages), whole(wages),
          whole(s.retirementEmployeeMinor),
          whole(s.retirementEmployerMinor),
          whole(s.pensionMinor),
          '0', '0',
        ].join('#~#');
      });
    return {
      filename: `pf-ecr-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}.txt`,
      body: `${lines.join('\n')}\n`,
    };
  }

  /** The ESI contribution file: insurance number, name, days, wages, contribution. */
  async healthFile(schoolId: string, runId: string): Promise<{ filename: string; body: string }> {
    const { run, slips, pay } = await this.locked(schoolId, runId);
    const lines = slips
      .filter((s) => s.healthEmployeeMinor > 0)
      .map((s) => {
        const p = pay.get(s.teacherId ?? s.staffId ?? '');
        return [clean(p?.esiNumber), clean(s.name), String(s.daysPaid), whole(s.grossMinor), whole(s.healthEmployeeMinor)].join(',');
      });
    return {
      filename: `esi-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}.csv`,
      body: `IP Number,Name,Days,Wages,Contribution\n${lines.join('\n')}\n`,
    };
  }

  /** The bank transfer file — account, name, amount, in the order the office pays. */
  async bankFile(schoolId: string, runId: string): Promise<{ filename: string; body: string }> {
    const { run, slips, pay } = await this.locked(schoolId, runId);
    const rows = slips.map((s) => {
      const p = pay.get(s.teacherId ?? s.staffId ?? '');
      return [
        clean(p?.bankAccount), clean(p?.bankIfsc), clean(s.name), rupees(s.netMinor),
        `SALARY ${String(run.periodMonth).padStart(2, '0')}/${run.periodYear}`,
      ].join(',');
    });
    const missing = slips.filter((s) => !pay.get(s.teacherId ?? s.staffId ?? '')?.bankAccount).length;
    return {
      filename: `bank-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}.csv`,
      body: `${missing ? `# ${missing} of ${slips.length} people have no bank account on file — their rows are blank.\n` : ''}Account,IFSC,Name,Amount,Narration\n${rows.join('\n')}\n`,
    };
  }

  /** The salary register: every person, every line, one wide sheet. */
  async registerFile(schoolId: string, runId: string): Promise<{ filename: string; body: string }> {
    const { run, slips } = await this.locked(schoolId, runId);
    const keys: string[] = [];
    for (const s of slips) for (const l of s.lines as { key: string; name: string }[]) if (!keys.includes(l.key)) keys.push(l.key);
    const header = ['Name', 'Role', 'Days paid', ...keys, 'Gross', 'Deductions', 'Net'];
    const rows = slips.map((s) => {
      const by = new Map((s.lines as { key: string; amountMinor: number }[]).map((l) => [l.key, l.amountMinor]));
      return [
        clean(s.name), clean(s.designation), String(s.daysPaid),
        ...keys.map((k) => rupees(by.get(k) ?? 0)),
        rupees(s.grossMinor), rupees(s.deductionMinor), rupees(s.netMinor),
      ].join(',');
    });
    return {
      filename: `salary-register-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}.csv`,
      body: `${header.join(',')}\n${rows.join('\n')}\n`,
    };
  }

  /**
   * One person's year: what India calls Form 130 since April 2026 (it was
   * Form 16). The certificate itself is generated by the tax portal after the
   * fourth-quarter return is processed — this is the salary computation that
   * goes into it, which is the part the school owes the person.
   */
  async annualStatement(schoolId: string, personKind: 'TEACHER' | 'STAFF', personId: string, taxYear: number) {
    const { pack } = await this.packs.forSchool(schoolId);
    return withTenant(schoolId, async (tx) => {
      const slips = await tx.payslip.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: {
          schoolId,
          ...(personKind === 'TEACHER' ? { teacherId: personId } : { staffId: personId }),
          payRun: { status: { in: ['LOCKED', 'PAID'] }, ...windowFor(pack, taxYear) },
        },
        orderBy: [{ payRun: { periodYear: 'asc' } }, { payRun: { periodMonth: 'asc' } }],
        select: {
          name: true, designation: true, grossMinor: true, deductionMinor: true, netMinor: true,
          incomeTaxMinor: true, retirementEmployeeMinor: true, localTaxMinor: true, lines: true, taxRegime: true,
          payRun: { select: { periodYear: true, periodMonth: true } },
        },
      });
      if (!slips.length) throw new ApiError('NOT_FOUND', 'No locked pay for that year yet.', 404);
      const total = (f: (s: (typeof slips)[number]) => number) => slips.reduce((a, s) => a + f(s), 0);
      return {
        person: { name: slips[0].name, designation: slips[0].designation },
        taxYear,
        label: pack.taxYearStartMonth === 1 ? String(taxYear) : `${taxYear}-${String((taxYear + 1) % 100).padStart(2, '0')}`,
        regime: slips[slips.length - 1].taxRegime,
        months: slips.map((s) => ({
          year: s.payRun.periodYear, month: s.payRun.periodMonth,
          grossMinor: s.grossMinor, taxMinor: s.incomeTaxMinor, netMinor: s.netMinor,
        })),
        totals: {
          grossMinor: total((s) => s.grossMinor),
          taxMinor: total((s) => s.incomeTaxMinor),
          retirementMinor: total((s) => s.retirementEmployeeMinor),
          localTaxMinor: total((s) => s.localTaxMinor),
          netMinor: total((s) => s.netMinor),
        },
        formName: pack.filings.find((f) => f.key === 'FORM_130')?.label ?? 'Annual certificate',
        note: 'Your school files the quarterly return; the certificate itself comes from the tax portal afterwards. This is the salary computation behind it.',
      };
    });
  }

  private async locked(schoolId: string, runId: string) {
    return withTenant(schoolId, async (tx) => {
      const run = await tx.payRun.findFirst({ where: { id: runId, schoolId } });
      if (!run) throw new ApiError('NOT_FOUND', 'No such pay run.', 404);
      if (run.status !== 'LOCKED' && run.status !== 'PAID') {
        throw new ApiError('PAY_RUN_STATE', 'Lock the run first — a file that can still change is worse than no file.', 409);
      }
      const slips = await tx.payslip.findMany({
        take: LIST_CEILING.ROSTER, where: { schoolId, payRunId: runId }, orderBy: { name: 'asc' },
      });
      const monthEnd = run.rulesAsAt;
      const pays = await tx.employeePay.findMany({
        take: LIST_CEILING.ROSTER, where: { schoolId, effectiveFrom: { lte: monthEnd } }, orderBy: { effectiveFrom: 'desc' },
      });
      const pay = new Map<string, (typeof pays)[number]>();
      for (const p of pays) {
        const key = p.teacherId ?? p.staffId!;
        if (!pay.has(key)) pay.set(key, p);
      }
      return { run, slips, pay };
    });
  }
}

function windowFor(pack: PayPack, taxYear: number) {
  const start = pack.taxYearStartMonth;
  if (start === 1) return { periodYear: taxYear };
  return {
    OR: [
      { periodYear: taxYear, periodMonth: { gte: start } },
      { periodYear: taxYear + 1, periodMonth: { lt: start } },
    ],
  };
}

export { asOf };
