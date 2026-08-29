import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { isP2002 } from '../../../common/errors/prisma-errors';
import { istTodayISO } from '../../management';
import { LibrarySettingsService } from './library-settings.service';
import {
  accruedFineRupees,
  dateOnlyISO,
  dueOnFor,
  finesApply,
  loanLimitFor,
  type BorrowerKind,
  type LibraryRules,
} from './library-policy';
import type { IssueDto } from './library.dto';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

export interface BorrowerRef {
  kind: BorrowerKind;
  id: string;
  name: string;
  /** Student code (RAF-00042) — null for teachers. */
  code: string | null;
  className: string | null;
  classSectionId: string | null;
}

export interface IssueCard {
  id: string;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string;
  borrower: BorrowerRef;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  wasLost: boolean;
  /** Fine earned so far on an open overdue loan (0 once returned — the crystallized row takes over). */
  accruedFineRupees: number;
}

export interface MemberCard {
  borrower: BorrowerRef;
  limit: number;
  holdings: IssueCard[];
  /** Crystallized DUE fines + accrual on open loans. */
  duesRupees: number;
}

const ISSUE_INCLUDE = {
  copy: { select: { accessionNo: true, title: { select: { id: true, title: true, author: true } } } },
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      code: true,
      classSectionId: true,
      classSection: { select: { name: true, grade: { select: { name: true } } } },
    },
  },
  teacher: { select: { id: true, firstName: true, lastName: true } },
} as const;

type IssueRow = {
  id: string;
  issuedOn: Date;
  dueOn: Date;
  returnedOn: Date | null;
  wasLost: boolean;
  copy: { accessionNo: string; title: { id: string; title: string; author: string } };
  student: {
    id: string;
    firstName: string;
    lastName: string;
    code: string | null;
    classSectionId: string | null;
    classSection: { name: string; grade: { name: string } } | null;
  } | null;
  teacher: { id: string; firstName: string; lastName: string } | null;
};

export function borrowerOf(row: IssueRow): BorrowerRef {
  if (row.student) {
    return {
      kind: 'STUDENT',
      id: row.student.id,
      name: `${row.student.firstName} ${row.student.lastName}`.trim(),
      code: row.student.code,
      className: row.student.classSection
        ? `${row.student.classSection.grade.name}${row.student.classSection.name}`
        : null,
      classSectionId: row.student.classSectionId,
    };
  }
  // The DB CHECK constraint guarantees one of the two.
  const t = row.teacher!;
  return {
    kind: 'TEACHER',
    id: t.id,
    name: `${t.firstName} ${t.lastName}`.trim(),
    code: null,
    className: null,
    classSectionId: null,
  };
}

export function toIssueCard(row: IssueRow, rules: LibraryRules, todayISO: string): IssueCard {
  const borrower = borrowerOf(row);
  const dueOn = dateOnlyISO(row.dueOn);
  return {
    id: row.id,
    accessionNo: row.copy.accessionNo,
    titleId: row.copy.title.id,
    title: row.copy.title.title,
    author: row.copy.title.author,
    borrower,
    issuedOn: dateOnlyISO(row.issuedOn),
    dueOn,
    returnedOn: row.returnedOn ? dateOnlyISO(row.returnedOn) : null,
    wasLost: row.wasLost,
    accruedFineRupees: row.returnedOn ? 0 : accruedFineRupees(rules, borrower.kind, dueOn, todayISO),
  };
}

/**
 * The Counter: issue, take back, undo, write off. Every mutation lives inside
 * ONE `withTenant` transaction; the two races that matter are handled where
 * the application cannot be trusted:
 *
 *  - double-issue of one physical copy → the partial unique index
 *    `LibraryIssue_open_copy_key` (P2002 → 409), like the register save;
 *  - limit check (count-then-insert of DIFFERENT rows) → a transaction-scoped
 *    `pg_advisory_xact_lock` on (schoolId, borrowerId). This is the repo's
 *    first advisory lock, deliberately: a limit-of-N has no unique index to
 *    lean on, and READ COMMITTED lets two concurrent transactions both count
 *    N-1 and both insert. The lock serialises per-borrower and releases at
 *    COMMIT/ROLLBACK automatically.
 */
@Injectable()
export class LibraryCirculationService {
  constructor(private readonly settings: LibrarySettingsService) {}

  // ── Members ─────────────────────────────────────────────

  async memberSearch(schoolId: string, q: string) {
    const query = q.trim();
    if (query.length < 2) return [];
    // "Kavya Rao" matches neither firstName nor lastName alone, and typing the
    // full name is how a librarian naturally searches — so a multi-word query
    // also tries first-word-as-firstName + rest-as-lastName (and reversed).
    const words = query.split(/\s+/);
    const nameSplits =
      words.length >= 2
        ? [
            {
              AND: [
                { firstName: { contains: words[0], mode: 'insensitive' as const } },
                { lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' as const } },
              ],
            },
            {
              AND: [
                { firstName: { contains: words.slice(0, -1).join(' '), mode: 'insensitive' as const } },
                { lastName: { contains: words[words.length - 1], mode: 'insensitive' as const } },
              ],
            },
          ]
        : [];
    return withTenant(schoolId, async (tx) => {
      const [students, teachers] = await Promise.all([
        tx.student.findMany({
          where: { schoolId,
            isActive: true,
            OR: [
              { code: { equals: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              ...nameSplits,
            ],
          },
          orderBy: [{ firstName: 'asc' }],
          take: 6,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            code: true,
            classSection: { select: { name: true, grade: { select: { name: true } } } },
          },
        }),
        tx.teacher.findMany({
          where: { schoolId,
            isActive: true,
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              ...nameSplits,
            ],
          },
          orderBy: [{ firstName: 'asc' }],
          take: 4,
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);
      const ids = {
        studentIds: students.map((s) => s.id),
        teacherIds: teachers.map((t) => t.id),
      };
      const open = await tx.libraryIssue.groupBy({
        by: ['studentId', 'teacherId'],
        where: { schoolId,
          returnedOn: null,
          OR: [{ studentId: { in: ids.studentIds } }, { teacherId: { in: ids.teacherIds } }],
        },
        _count: { _all: true },
      });
      const openByStudent = new Map<string, number>();
      const openByTeacher = new Map<string, number>();
      for (const g of open) {
        if (g.studentId) openByStudent.set(g.studentId, g._count._all);
        if (g.teacherId) openByTeacher.set(g.teacherId, g._count._all);
      }
      return [
        ...students.map((s) => ({
          kind: 'STUDENT' as const,
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          code: s.code,
          className: s.classSection ? `${s.classSection.grade.name}${s.classSection.name}` : null,
          holding: openByStudent.get(s.id) ?? 0,
        })),
        ...teachers.map((t) => ({
          kind: 'TEACHER' as const,
          id: t.id,
          name: `${t.firstName} ${t.lastName}`.trim(),
          code: null,
          className: null,
          holding: openByTeacher.get(t.id) ?? 0,
        })),
      ];
    });
  }

  async memberCard(schoolId: string, kind: BorrowerKind, id: string): Promise<MemberCard> {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const where = kind === 'STUDENT' ? { studentId: id } : { teacherId: id };
      const [holdings, borrower] = await Promise.all([
        tx.libraryIssue.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, ...where, returnedOn: null },
          orderBy: { dueOn: 'asc' },
          include: ISSUE_INCLUDE,
        }),
        this.resolveBorrower(tx, kind, id),
      ]);
      const fixed = await tx.libraryFine.aggregate({
        where: { schoolId, ...where, status: 'DUE' },
        _sum: { amountRupees: true },
      });
      const cards = holdings.map((h) => toIssueCard(h, rules, todayISO));
      const accrued = finesApply(rules, kind)
        ? cards.reduce((n, c) => n + c.accruedFineRupees, 0)
        : 0;
      const fixedDue = finesApply(rules, kind) ? (fixed._sum.amountRupees ?? 0) : 0;
      return {
        borrower,
        limit: loanLimitFor(rules, kind),
        holdings: cards,
        duesRupees: fixedDue + accrued,
      };
    });
  }

  private async resolveBorrower(tx: TenantTx, kind: BorrowerKind, id: string): Promise<BorrowerRef> {
    if (kind === 'STUDENT') {
      const s = await tx.student.findFirst({
        where: { id, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          code: true,
          classSectionId: true,
          classSection: { select: { name: true, grade: { select: { name: true } } } },
        },
      });
      if (!s) throw new ApiError('NOT_A_STUDENT', 'No such student.', 404);
      return {
        kind,
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        code: s.code,
        className: s.classSection ? `${s.classSection.grade.name}${s.classSection.name}` : null,
        classSectionId: s.classSectionId,
      };
    }
    const t = await tx.teacher.findFirst({
      where: { id, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!t) throw new ApiError('NOT_A_TEACHER', 'No such teacher.', 404);
    return {
      kind,
      id: t.id,
      name: `${t.firstName} ${t.lastName}`.trim(),
      code: null,
      className: null,
      classSectionId: null,
    };
  }

  // ── Issue ───────────────────────────────────────────────

  async issue(schoolId: string, librarianUserId: string, dto: IssueDto): Promise<IssueCard> {
    if (!dto.studentId === !dto.teacherId) {
      throw new ApiError('VALIDATION', 'Pick exactly one reader (studentId or teacherId).', 400);
    }
    if (!dto.copyId === !dto.titleId) {
      throw new ApiError('VALIDATION', 'Pick exactly one of copyId or titleId.', 400);
    }
    const kind: BorrowerKind = dto.studentId ? 'STUDENT' : 'TEACHER';
    const borrowerId = (dto.studentId ?? dto.teacherId)!;
    const todayISO = istTodayISO();

    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      await this.resolveBorrower(tx, kind, borrowerId);

      // Serialise per-borrower BEFORE the count — see the class docstring.
      // ::text because pg_advisory_xact_lock returns SQL `void`, which
      // $queryRaw cannot deserialize ("Failed to deserialize column of type
      // 'void'") — it 500ed the first real issue on staging while every
      // mocked unit test was green.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}), hashtext(${borrowerId}))::text`;

      const borrowerWhere = kind === 'STUDENT' ? { studentId: borrowerId } : { teacherId: borrowerId };
      const openCount = await tx.libraryIssue.count({ where: { schoolId, ...borrowerWhere, returnedOn: null } });
      const limit = loanLimitFor(rules, kind);
      if (openCount >= limit && !dto.override) {
        throw new ApiError(
          'LIBRARY_LIMIT',
          `Already holding ${openCount} of ${limit}. Send override: true to issue anyway.`,
          409,
        );
      }

      // Resolve the copy (a specific one, or any free copy of the title).
      let copy: { id: string; titleId: string } | null = null;
      if (dto.copyId) {
        const c = await tx.libraryBookCopy.findFirst({
          where: { schoolId, id: dto.copyId, lostAt: null },
          select: { id: true, titleId: true, issues: { where: { returnedOn: null }, select: { id: true } } },
        });
        if (!c) throw new ApiError('NOT_FOUND', 'No such copy (or it is written off).', 404);
        if (c.issues.length) throw new ApiError('LIBRARY_UNAVAILABLE', 'That copy is already out.', 409);
        copy = { id: c.id, titleId: c.titleId };
      } else {
        const free = await tx.libraryBookCopy.findFirst({
          where: { schoolId, titleId: dto.titleId!, lostAt: null, issues: { none: { returnedOn: null } } },
          orderBy: { accessionNo: 'asc' },
          select: { id: true, titleId: true },
        });
        if (!free) {
          const earliest = await tx.libraryIssue.findFirst({
            where: { schoolId, copy: { titleId: dto.titleId! }, returnedOn: null },
            orderBy: { dueOn: 'asc' },
            select: { dueOn: true },
          });
          throw new ApiError(
            'LIBRARY_UNAVAILABLE',
            earliest
              ? `Every copy is out — earliest back ${dateOnlyISO(earliest.dueOn)}.`
              : 'No copies left (all written off).',
            409,
          );
        }
        copy = free;
      }

      const already = await tx.libraryIssue.findFirst({
        where: { schoolId, ...borrowerWhere, returnedOn: null, copy: { titleId: copy.titleId } },
        select: { id: true },
      });
      if (already && !dto.override) {
        throw new ApiError(
          'LIBRARY_DUPLICATE_TITLE',
          'Already holding a copy of this title. Send override: true to issue anyway.',
          409,
        );
      }

      try {
        const created = await tx.libraryIssue.create({
          data: {
            schoolId,
            copyId: copy.id,
            studentId: dto.studentId ?? null,
            teacherId: dto.teacherId ?? null,
            issuedOn: new Date(`${todayISO}T00:00:00.000Z`),
            dueOn: new Date(`${dueOnFor(rules, todayISO)}T00:00:00.000Z`),
            issuedById: librarianUserId,
          },
          include: ISSUE_INCLUDE,
        });
        return toIssueCard(created, rules, todayISO);
      } catch (e) {
        // The partial unique index caught a concurrent issue of the same copy.
        if (isP2002(e)) {
          throw new ApiError('LIBRARY_UNAVAILABLE', 'That copy was just issued to someone else.', 409);
        }
        throw e;
      }
    });
  }

  // ── Take back / undo / write off ────────────────────────

  /** Returns the book; a late loan crystallizes its fine as a DUE LibraryFine row. */
  async returnIssue(schoolId: string, librarianUserId: string, issueId: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const issue = await tx.libraryIssue.findFirst({ where: { id: issueId }, include: ISSUE_INCLUDE });
      if (!issue) throw new ApiError('NOT_FOUND', 'No such issue.', 404);
      if (issue.returnedOn) throw new ApiError('LIBRARY_NOT_OPEN', 'Already returned.', 409);

      const borrower = borrowerOf(issue);
      const fineRupees = accruedFineRupees(rules, borrower.kind, dateOnlyISO(issue.dueOn), todayISO);

      const updated = await tx.libraryIssue.update({
        where: { id: issueId },
        data: { returnedOn: new Date(`${todayISO}T00:00:00.000Z`), returnedById: librarianUserId },
        include: ISSUE_INCLUDE,
      });
      let fineId: string | null = null;
      if (fineRupees > 0) {
        const fine = await tx.libraryFine.create({
          data: {
            schoolId,
            issueId,
            studentId: issue.studentId,
            teacherId: issue.teacherId,
            amountRupees: fineRupees,
            reason: 'LATE',
          },
        });
        fineId = fine.id;
      }
      return { issue: toIssueCard(updated, rules, todayISO), fineRupees, fineId };
    });
  }

  /** Undo a return: reopen the loan and delete its (still-DUE) LATE fine. */
  async reopen(schoolId: string, issueId: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const issue = await tx.libraryIssue.findFirst({
        where: { id: issueId },
        include: { ...ISSUE_INCLUDE, fines: true },
      });
      if (!issue) throw new ApiError('NOT_FOUND', 'No such issue.', 404);
      if (!issue.returnedOn || issue.wasLost) {
        throw new ApiError('LIBRARY_NOT_OPEN', 'Nothing to undo on this loan.', 409);
      }
      if (issue.fines.some((f) => f.status !== 'DUE')) {
        throw new ApiError('LIBRARY_FINE_SETTLED', 'Its fine was already settled — reopen that first.', 409);
      }
      // A racing issue of the same copy makes reopening ambiguous; the partial
      // unique index turns that into a 409 rather than two open loans.
      try {
        await tx.libraryFine.deleteMany({ where: { schoolId, issueId, status: 'DUE' } });
        const updated = await tx.libraryIssue.update({
          where: { id: issueId },
          data: { returnedOn: null, returnedById: null },
          include: ISSUE_INCLUDE,
        });
        return toIssueCard(updated, rules, todayISO);
      } catch (e) {
        if (isP2002(e)) {
          throw new ApiError('LIBRARY_UNAVAILABLE', 'That copy has already been issued to someone else.', 409);
        }
        throw e;
      }
    });
  }

  /** Void a mistyped, still-open issue — it never happened. */
  async voidIssue(schoolId: string, issueId: string) {
    return withTenant(schoolId, async (tx) => {
      const issue = await tx.libraryIssue.findFirst({ where: { id: issueId }, select: { id: true, returnedOn: true } });
      if (!issue) throw new ApiError('NOT_FOUND', 'No such issue.', 404);
      if (issue.returnedOn) throw new ApiError('LIBRARY_NOT_OPEN', 'Returned loans cannot be voided — undo the return first.', 409);
      await tx.libraryIssue.delete({ where: { id: issueId } });
      return { ok: true };
    });
  }

  /**
   * Write the copy off on this loan: closes it (if open), retires the copy,
   * and charges the flat replacement fee — unless the reader is a teacher
   * with teacher-fines off, in which case no fine row is written at all.
   */
  async markLost(schoolId: string, librarianUserId: string, issueId: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const issue = await tx.libraryIssue.findFirst({
        where: { id: issueId },
        include: { ...ISSUE_INCLUDE, copy: { select: { id: true, lostAt: true, accessionNo: true, title: { select: { id: true, title: true, author: true } } } } },
      });
      if (!issue) throw new ApiError('NOT_FOUND', 'No such issue.', 404);
      if (issue.copy.lostAt || issue.wasLost) {
        throw new ApiError('LIBRARY_NOT_OPEN', 'This copy is already written off.', 409);
      }
      const borrower = borrowerOf(issue);
      await tx.libraryBookCopy.update({ where: { id: issue.copy.id }, data: { lostAt: new Date() } });
      const updated = await tx.libraryIssue.update({
        where: { id: issueId },
        data: {
          wasLost: true,
          returnedOn: issue.returnedOn ?? new Date(`${todayISO}T00:00:00.000Z`),
          returnedById: issue.returnedById ?? librarianUserId,
        },
        include: ISSUE_INCLUDE,
      });
      let fineId: string | null = null;
      const fee = finesApply(rules, borrower.kind) ? rules.lostFeeRupees : 0;
      if (fee > 0) {
        const fine = await tx.libraryFine.create({
          data: {
            schoolId,
            issueId,
            studentId: issue.studentId,
            teacherId: issue.teacherId,
            amountRupees: fee,
            reason: 'LOST',
          },
        });
        fineId = fine.id;
      }
      return { issue: toIssueCard(updated, rules, todayISO), fineRupees: fee, fineId };
    });
  }

  /** Undo a write-off: the copy is back on the shelf, its unpaid LOST fine vanishes. */
  async unlose(schoolId: string, issueId: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const issue = await tx.libraryIssue.findFirst({
        where: { id: issueId },
        include: { ...ISSUE_INCLUDE, fines: { where: { reason: 'LOST' } }, copy: { select: { id: true, accessionNo: true, title: { select: { id: true, title: true, author: true } } } } },
      });
      if (!issue) throw new ApiError('NOT_FOUND', 'No such issue.', 404);
      if (!issue.wasLost) throw new ApiError('LIBRARY_NOT_OPEN', 'This loan was not written off.', 409);
      if (issue.fines.some((f) => f.status === 'PAID')) {
        throw new ApiError('LIBRARY_FINE_SETTLED', 'The replacement was already collected — reopen that fine first.', 409);
      }
      await tx.libraryFine.deleteMany({ where: { schoolId, issueId, reason: 'LOST', status: { not: 'PAID' } } });
      await tx.libraryBookCopy.update({ where: { id: issue.copy.id }, data: { lostAt: null } });
      const updated = await tx.libraryIssue.update({
        where: { id: issueId },
        data: { wasLost: false },
        include: ISSUE_INCLUDE,
      });
      return toIssueCard(updated, rules, todayISO);
    });
  }

  // ── Dashboard ───────────────────────────────────────────

  async dashboard(schoolId: string) {
    const todayISO = istTodayISO();
    const weekOut = new Date(`${todayISO}T00:00:00.000Z`);
    weekOut.setUTCDate(weekOut.getUTCDate() + 7);

    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const [totalCopies, lostCopies, totalTitles, outNowCount, openRows, collected, fixedDue] = await Promise.all([
        tx.libraryBookCopy.count(),
        tx.libraryBookCopy.count({ where: { schoolId, lostAt: { not: null } } }),
        tx.libraryBookTitle.count(),
        tx.libraryIssue.count({ where: { schoolId, returnedOn: null } }),
        tx.libraryIssue.findMany({
          where: { schoolId, returnedOn: null },
          orderBy: { dueOn: 'asc' },
          take: 200,
          include: ISSUE_INCLUDE,
        }),
        tx.libraryFine.aggregate({ where: { schoolId, status: 'PAID' }, _sum: { amountRupees: true } }),
        tx.libraryFine.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, status: 'DUE' }, select: { amountRupees: true, teacherId: true } }),
      ]);
      const openCards = openRows.map((r) => toIssueCard(r, rules, todayISO));
      const dueSoon = openCards.filter((c) => c.dueOn >= todayISO && c.dueOn <= dateOnlyISO(weekOut));
      const accruedDue = openCards.reduce((n, c) => n + c.accruedFineRupees, 0);
      const fixedDueSum = fixedDue
        .filter((f) => rules.fineTeachers || !f.teacherId)
        .reduce((n, f) => n + f.amountRupees, 0);
      return {
        counts: {
          totalCopies,
          lostCopies,
          totalTitles,
          outNow: outNowCount,
          dueSoon: dueSoon.length,
          finesCollectedRupees: collected._sum.amountRupees ?? 0,
          finesDueRupees: fixedDueSum + accruedDue,
        },
        outNow: openCards,
        dueSoon,
        today: todayISO,
      };
    });
  }
}
