import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { istTodayISO } from '../../management';
import { LibrarySettingsService } from './library-settings.service';
import {
  accruedFineRupees,
  dateOnlyISO,
  finesApply,
  loanLimitFor,
  type BorrowerKind,
} from './library-policy';

/**
 * The reader's own view (`/me/library`) — what the student's phone ribbon and
 * the teacher's Library tab render. Fines are simply absent (zero, empty)
 * for teachers while fineTeachers is off; the client never has to know the
 * rule, only the numbers.
 */
@Injectable()
export class LibraryMeService {
  constructor(private readonly settings: LibrarySettingsService) {}

  async forUser(schoolId: string, userId: string, role: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      let kind: BorrowerKind;
      let borrowerId: string;
      if (role === 'STUDENT') {
        const s = await tx.student.findFirst({ where: { schoolId, userId }, select: { id: true } });
        if (!s) throw new ApiError('NOT_A_STUDENT', 'No student record for this login.', 404);
        kind = 'STUDENT';
        borrowerId = s.id;
      } else if (role === 'TEACHER') {
        const t = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
        if (!t) throw new ApiError('NOT_A_TEACHER', 'No teacher record for this login.', 404);
        kind = 'TEACHER';
        borrowerId = t.id;
      } else {
        throw new ApiError('NOT_FOUND', 'Only students and teachers have a library shelf.', 404);
      }

      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const where = kind === 'STUDENT' ? { studentId: borrowerId } : { teacherId: borrowerId };
      const showFines = finesApply(rules, kind);

      const [open, history, fixedDue] = await Promise.all([
        tx.libraryIssue.findMany({
          where: { schoolId, ...where, returnedOn: null },
          orderBy: { dueOn: 'asc' },
          include: { copy: { select: { accessionNo: true, title: { select: { title: true, author: true } } } } },
        }),
        tx.libraryIssue.findMany({
          where: { schoolId, ...where, returnedOn: { not: null } },
          orderBy: { returnedOn: 'desc' },
          take: 50,
          include: { copy: { select: { accessionNo: true, title: { select: { title: true, author: true } } } } },
        }),
        tx.libraryFine.findMany({
          where: { schoolId, ...where, status: 'DUE' },
          orderBy: { createdAt: 'asc' },
          include: { issue: { select: { copy: { select: { title: { select: { title: true } } } } } } },
        }),
      ]);

      const holdings = open.map((i) => {
        const dueOn = dateOnlyISO(i.dueOn);
        const daysLeft = Math.round(
          (Date.parse(`${dueOn}T00:00:00.000Z`) - Date.parse(`${todayISO}T00:00:00.000Z`)) / 86_400_000,
        );
        return {
          issueId: i.id,
          title: i.copy.title.title,
          author: i.copy.title.author,
          accessionNo: i.copy.accessionNo,
          issuedOn: dateOnlyISO(i.issuedOn),
          dueOn,
          daysLeft,
          accruedFineRupees: showFines ? accruedFineRupees(rules, kind, dueOn, todayISO) : 0,
        };
      });

      const fines = showFines
        ? fixedDue.map((f) => ({
            id: f.id,
            title: f.issue.copy.title.title,
            reason: f.reason,
            amountRupees: f.amountRupees,
          }))
        : [];

      return {
        kind,
        limit: loanLimitFor(rules, kind),
        loanDays: rules.loanDays,
        finesEnabled: showFines,
        holdings,
        history: history.map((i) => ({
          issueId: i.id,
          title: i.copy.title.title,
          author: i.copy.title.author,
          returnedOn: dateOnlyISO(i.returnedOn!),
          wasLost: i.wasLost,
        })),
        fines,
        finesDueRupees:
          fines.reduce((n, f) => n + f.amountRupees, 0) +
          holdings.reduce((n, h) => n + h.accruedFineRupees, 0),
        today: todayISO,
      };
    });
  }
}
