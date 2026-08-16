import { Injectable } from '@nestjs/common';
// Types come via @skoolos/db, never '@prisma/client' directly: the Vercel
// api build only guarantees the workspace-wrapped client (see prisma-errors.ts).
import { withTenant, type TenantTx, type LibrarySettings } from '@skoolos/db';
import { isP2002 } from '../../../common/errors/prisma-errors';
import type { LibraryRules } from './library-policy';
import type { UpdateLibrarySettingsDto } from './library.dto';

/**
 * One `LibrarySettings` row per school, created on first read with the
 * approved defaults (2/student, 5/teacher, 14-day loan, ₹5/day after 1 grace
 * day, ₹120 lost, teacher fines OFF, reminders ON — all in schema.prisma
 * `@default`s, the single source of truth). The librarian edits it from the
 * portal gear; the school admin edits the SAME row from Admin → Settings.
 */
@Injectable()
export class LibrarySettingsService {
  /** Read-or-create inside an existing `withTenant` transaction. */
  async ensure(tx: TenantTx, schoolId: string): Promise<LibrarySettings> {
    const existing = await tx.librarySettings.findUnique({ where: { schoolId } });
    if (existing) return existing;
    try {
      return await tx.librarySettings.create({ data: { schoolId } });
    } catch (e) {
      // Two first-reads racing: the loser re-reads the winner's row.
      if (isP2002(e)) {
        const row = await tx.librarySettings.findUnique({ where: { schoolId } });
        if (row) return row;
      }
      throw e;
    }
  }

  get(schoolId: string): Promise<LibrarySettings> {
    return withTenant(schoolId, (tx) => this.ensure(tx, schoolId));
  }

  update(schoolId: string, dto: UpdateLibrarySettingsDto): Promise<LibrarySettings> {
    return withTenant(schoolId, async (tx) => {
      await this.ensure(tx, schoolId);
      return tx.librarySettings.update({ where: { schoolId }, data: { ...dto } });
    });
  }

  /** The policy-math view of a settings row. */
  rules(s: LibrarySettings): LibraryRules {
    return {
      studentLoanLimit: s.studentLoanLimit,
      teacherLoanLimit: s.teacherLoanLimit,
      loanDays: s.loanDays,
      finePerDayRupees: s.finePerDayRupees,
      graceDays: s.graceDays,
      lostFeeRupees: s.lostFeeRupees,
      fineTeachers: s.fineTeachers,
    };
  }
}
