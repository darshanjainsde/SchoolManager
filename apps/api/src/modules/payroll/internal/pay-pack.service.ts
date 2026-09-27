import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { hasPack, packFor, periodEndISO, taxYearLabel, taxYearOf, type PayPack } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';

export interface SchoolPay {
  countryCode: string;
  currency: string;
  region: string | null;
  taxYearStartMonth: number;
  pack: PayPack;
}

/**
 * The school's rule book, and the date to read it at.
 *
 * Every figure the module produces comes from a pack row that carries the date
 * it took effect, and a run records which pack version it used — so a school
 * can be told, a year later, which rule book produced a number. The "rules
 * current as at" line on every pay run is this service's `rulesAsAt`, shown
 * rather than hidden: a promise to keep every rate current forever is one we
 * cannot keep, and saying when we last checked is the honest version.
 */
@Injectable()
export class PayPackService {
  async forSchool(schoolId: string): Promise<SchoolPay> {
    const s = await getPlatformPrisma().school.findUnique({
      where: { id: schoolId },
      select: { countryCode: true, currency: true, region: true, taxYearStartMonth: true },
    });
    if (!s) throw new ApiError('NOT_FOUND', 'No such school.', 404);
    if (!hasPack(s.countryCode)) {
      throw new ApiError(
        'SALARY_NO_PACK',
        `Salary is not set up for ${s.countryCode} yet — only India has a rule book so far. Ask us before you run pay for this school.`,
        400,
      );
    }
    return { ...s, pack: packFor(s.countryCode) };
  }

  /**
   * The LAST day of the month, which is the date every rate table is read at.
   * Pay is earned across the month and filed after it, so a rule that starts
   * mid-month applies to that whole month — India's provident-fund ceiling rose
   * on 17 September 2026 and September's contributions use the new one.
   */
  rulesDate(year: number, month: number): string {
    return periodEndISO(year, month);
  }

  taxYear(pack: PayPack, year: number, month: number) {
    const t = taxYearOf(pack, year, month);
    return { ...t, label: taxYearLabel(pack, t.taxYear) };
  }
}
