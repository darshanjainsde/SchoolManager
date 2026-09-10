import { Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { AuditService } from '../../../common/audit/audit.service';
import { MailService } from '../../../common/mail/mail.service';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { runInBackground } from '../../../common/notifications/run-in-background';
import { todayInZone, ymdString } from '../../../common/dates/birthdays';
import type { LibraryNoticeOutboxPayload } from '../../../common/notifications/notification.types';
import { LibrarySettingsService } from './library-settings.service';
import { accruedFineRupees, dateOnlyISO, finesApply, isDateISO, lateDays } from './library-policy';

/**
 * The library at the year end (Active Roster, Track C) — the one door the
 * Sessions tab has into the library wing. Three things the office asks for
 * while closing a year, none of them a condition of Start:
 *
 *  1. WHAT is still out, child by child, with the fine so far.
 *  2. REMIND every family at once (bell + push + mail), the same wording the
 *     due-soon nudge uses, so the family sees one voice from the library.
 *  3. A LAST DUE DATE: a book issued a week before the year ends is, by the
 *     loan policy, due after the session. One click brings every such due
 *     date forward to a chosen day (never earlier than today), so the fine
 *     clock starts there. Books already overdue are untouched — their fine
 *     keeps counting from the day they were actually due.
 */

export interface OpenLoanRow {
  issueId: string;
  studentId: string;
  name: string;
  code: string | null;
  className: string | null;
  hasLogin: boolean;
  title: string;
  accessionNo: string;
  issuedOn: string;
  dueOn: string;
  daysLate: number;
  fineRupees: number;
  /** Due after the closing session's last day — the ones the last-due-date click brings forward. */
  dueAfterSession: boolean;
}

export interface OpenLoansResult {
  today: string;
  sessionEndOn: string | null;
  rules: { finePerDayRupees: number; graceDays: number; fineStudents: boolean };
  counts: { out: number; overdue: number; dueAfterSession: number; noLogin: number; accruingRupees: number };
  rows: OpenLoanRow[];
}

@Injectable()
export class LibraryYearEndService {
  private readonly logger = new Logger(LibraryYearEndService.name);

  constructor(
    private readonly settings: LibrarySettingsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private async todayISO(tx: TenantTx, schoolId: string): Promise<string> {
    const school = await tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    return ymdString(todayInZone(school?.timezone ?? 'Asia/Kolkata'));
  }

  private openStudentLoans(tx: TenantTx, schoolId: string) {
    return tx.libraryIssue.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, returnedOn: null, wasLost: false, studentId: { not: null }, student: { status: 'ACTIVE' } },
      orderBy: [{ dueOn: 'asc' }, { issuedOn: 'asc' }],
      select: {
        id: true, issuedOn: true, dueOn: true,
        copy: { select: { accessionNo: true, title: { select: { title: true } } } },
        student: { select: { id: true, firstName: true, lastName: true, code: true, userId: true, classSection: { select: { name: true, grade: { select: { name: true } } } } } },
      },
    });
  }

  /** Every open student loan, with the fine so far. `sessionEndOn` marks the ones due after the year. */
  async openLoans(schoolId: string, sessionEndOn?: Date | null): Promise<OpenLoansResult> {
    return withTenant(schoolId, async (tx) => {
      const [today, settings, issues] = await Promise.all([this.todayISO(tx, schoolId), this.settings.ensure(tx, schoolId), this.openStudentLoans(tx, schoolId)]);
      const rules = this.settings.rules(settings);
      const fineStudents = finesApply(rules, 'STUDENT');
      const endISO = sessionEndOn ? dateOnlyISO(sessionEndOn) : null;
      const rows: OpenLoanRow[] = issues.map((i) => {
        const dueOn = dateOnlyISO(i.dueOn);
        const s = i.student!;
        return {
          issueId: i.id,
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          code: s.code,
          className: s.classSection ? `${s.classSection.grade.name} ${s.classSection.name}` : null,
          hasLogin: !!s.userId,
          title: i.copy.title.title,
          accessionNo: i.copy.accessionNo,
          issuedOn: dateOnlyISO(i.issuedOn),
          dueOn,
          daysLate: lateDays(dueOn, today),
          fineRupees: accruedFineRupees(rules, 'STUDENT', dueOn, today),
          dueAfterSession: endISO !== null && dueOn > endISO,
        };
      });
      return {
        today,
        sessionEndOn: endISO,
        rules: { finePerDayRupees: rules.finePerDayRupees, graceDays: rules.graceDays, fineStudents },
        counts: {
          out: rows.length,
          overdue: rows.filter((r) => r.daysLate > 0).length,
          dueAfterSession: rows.filter((r) => r.dueAfterSession).length,
          noLogin: rows.filter((r) => !r.hasLogin).length,
          accruingRupees: rows.reduce((n, r) => n + r.fineRupees, 0),
        },
        rows,
      };
    });
  }

  /**
   * One reminder per open loan to the child's family: the bell and the push in
   * one statement each, the mails in the background. Families without a login
   * are counted, not reached — the office sees that number and phones them.
   */
  async remindOpenLoans(schoolId: string, actorUserId: string): Promise<{ reminded: number; noLogin: number }> {
    const { rows, schoolName } = await withTenant(schoolId, async (tx) => {
      const [today, settings, issues, school] = await Promise.all([
        this.todayISO(tx, schoolId),
        this.settings.ensure(tx, schoolId),
        this.openStudentLoans(tx, schoolId),
        tx.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
      ]);
      const rules = this.settings.rules(settings);
      const rows = issues
        .filter((i) => i.student?.userId)
        .map((i) => {
          const dueOn = dateOnlyISO(i.dueOn);
          const fine = accruedFineRupees(rules, 'STUDENT', dueOn, today);
          const late = lateDays(dueOn, today);
          const title = `“${i.copy.title.title}” is still out`;
          const body = late > 0 ? `Was due ${dueOn} · ${i.copy.accessionNo}${fine > 0 ? ` · fine so far ₹${fine}` : ''}` : `Due ${dueOn} · ${i.copy.accessionNo}. Please return it before the session ends.`;
          return { userId: i.student!.userId!, readerName: `${i.student!.firstName} ${i.student!.lastName}`.trim(), title, body, bookTitle: i.copy.title.title, accessionNo: i.copy.accessionNo, dueOn };
        });
      if (rows.length) {
        await tx.notification.createMany({
          data: rows.map((r) => ({ schoolId, userId: r.userId, kind: 'LIBRARY', title: r.title, body: r.body, linkType: 'library', linkId: null })),
        });
        await tx.notificationOutbox.createMany({
          data: rows.map((r) => ({
            schoolId, kind: 'LIBRARY_NOTICE', targetUserId: r.userId,
            payload: { schoolName: school?.name ?? '', title: r.title, body: r.body } satisfies LibraryNoticeOutboxPayload as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return { rows, schoolName: school?.name ?? '', noLogin: issues.length - rows.length };
    }).then((r) => ({ ...r }));
    const noLogin = await withTenant(schoolId, async (tx) => (await this.openStudentLoans(tx, schoolId)).filter((i) => !i.student?.userId).length);

    runInBackground(
      async () => {
        const users = await withTenant(schoolId, (tx) =>
          tx.user.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, id: { in: rows.map((r) => r.userId) } }, select: { id: true, email: true } }),
        );
        const email = new Map(users.map((u) => [u.id, u.email]));
        for (const r of rows) {
          const to = email.get(r.userId);
          if (!to) continue;
          await this.mail.sendLetter(to, schoolId, `${schoolName} library — “${r.bookTitle}” is still out`, {
            title: 'A library book is still out',
            intro: `${r.readerName}'s library book has not come back yet. Please return it before the session ends.`,
            rows: [
              { label: 'Book', value: r.bookTitle },
              { label: 'Copy', value: r.accessionNo },
              { label: 'Due', value: r.dueOn },
            ],
            note: 'The fine, if any, keeps counting from the due date until the book is back on the shelf.',
          });
        }
      },
      (e) => this.logger.error(`year-end library reminders for ${schoolId} failed: ${(e as Error).message}`),
    );
    await this.audit.record({ schoolId, actorUserId, action: 'library.yearend.remind', entity: 'LibraryIssue', entityId: schoolId, meta: { reminded: rows.length, noLogin } });
    return { reminded: rows.length, noLogin };
  }

  /**
   * Bring every open student loan due AFTER `lastDueOn` forward to that day.
   * Never earlier than today (that would invent an instant fine); books already
   * due on or before that day are untouched, so a fine already counting keeps
   * counting. Idempotent — running it twice changes nothing the second time.
   */
  async capDueDates(schoolId: string, actorUserId: string, lastDueOn: string): Promise<{ changed: number; lastDueOn: string }> {
    if (!isDateISO(lastDueOn)) throw new ApiError('VALIDATION', 'Give the last due date as YYYY-MM-DD', 400, 'lastDueOn');
    const changed = await withTenant(schoolId, async (tx) => {
      const today = await this.todayISO(tx, schoolId);
      if (lastDueOn < today) throw new ApiError('VALIDATION', 'The last due date cannot be in the past', 400, 'lastDueOn');
      const cap = new Date(`${lastDueOn}T00:00:00.000Z`);
      const r = await tx.libraryIssue.updateMany({
        where: { schoolId, returnedOn: null, wasLost: false, studentId: { not: null }, dueOn: { gt: cap } },
        data: { dueOn: cap },
      });
      return r.count;
    });
    await this.audit.record({ schoolId, actorUserId, action: 'library.yearend.cap-due', entity: 'LibraryIssue', entityId: schoolId, meta: { lastDueOn, changed } });
    return { changed, lastDueOn };
  }
}
