import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { assertPressDocType, type StudentReport } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { FeatureResolverService } from '../features';
import { ReportCardService } from '../press';
import { istToday } from './bell.service';

/**
 * The Student 360 — everything the school's registers hold about one child,
 * composed live for the office and for the printed report a parent requests.
 *
 * Nothing here is stored or cached: the number on the profile is the number
 * in the register, always (the compute-don't-store rule). The academics
 * panel reuses the Press's own compile — published marks only — so this
 * screen, the batch screen and the printed card cannot disagree.
 */
@Injectable()
export class StudentReportService {
  constructor(
    private readonly features: FeatureResolverService,
    private readonly press: ReportCardService,
  ) {}

  async report(schoolId: string, studentId: string): Promise<StudentReport> {
    const hasFees = (await this.features.getFeatures(schoolId)).has('FEES');
    const { dateOnly } = istToday();

    const base = await withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId },
        include: { classSection: { include: { grade: { select: { name: true } } } } },
      });
      if (!student) throw new ApiError('NOT_FOUND', 'That student was not found.', 404);

      // The session window: the current academic year's start → today. A
      // school with no year yet gets the last 12 months — an honest default,
      // never a crash.
      const year =
        (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { startDate: true } })) ??
        (await tx.academicYear.findFirst({ orderBy: { startDate: 'desc' }, select: { startDate: true } }));
      const sessionStart = year?.startDate ?? new Date(dateOnly.getTime() - 365 * 24 * 60 * 60 * 1000);

      const [attAgg, last20, documents, library] = await Promise.all([
        tx.attendance.groupBy({
          by: ['status'],
          where: { studentId, date: { gte: sessionStart, lte: dateOnly } },
          _count: { _all: true },
        }),
        tx.attendance.findMany({
          where: { studentId },
          select: { date: true, status: true },
          orderBy: { date: 'desc' },
          take: 20,
        }),
        tx.pressIssue.findMany({
          where: { studentId },
          select: { id: true, type: true, serial: true, issuedAt: true, voidedAt: true },
          orderBy: { issuedAt: 'desc' },
        }),
        tx.libraryIssue.findMany({
          where: { studentId },
          include: { copy: { include: { title: { select: { title: true } } } } },
          // Open loans first, then the most recent returns.
          orderBy: [{ returnedOn: { sort: 'asc', nulls: 'first' } }, { issuedOn: 'desc' }],
          take: 6,
        }),
      ]);

      let present = 0;
      let total = 0;
      for (const row of attAgg) {
        const n = row._count._all;
        total += n;
        if (row.status === 'PRESENT' || row.status === 'LATE') present += n;
      }

      let fees: StudentReport['fees'] = null;
      if (hasFees) {
        const [sums, ledger] = await Promise.all([
          tx.feeLedgerEntry.groupBy({
            by: ['kind'],
            where: { studentId },
            _sum: { amountMinor: true },
          }),
          tx.feeLedgerEntry.findMany({
            where: { studentId },
            select: { narration: true, occurredAt: true, kind: true, amountMinor: true },
            orderBy: { occurredAt: 'desc' },
            take: 8,
          }),
        ]);
        const billed = sums.find((s) => s.kind === 'DEBIT')?._sum.amountMinor ?? 0;
        const paid = sums.find((s) => s.kind === 'CREDIT')?._sum.amountMinor ?? 0;
        fees = {
          billedMinor: billed,
          paidMinor: paid,
          dueMinor: billed - paid,
          ledger: ledger.map((l) => ({
            narration: l.narration,
            occurredAt: l.occurredAt.toISOString(),
            kind: l.kind,
            amountMinor: l.amountMinor,
          })),
        };
      }

      return {
        student: {
          id: student.id,
          name: `${student.firstName} ${student.lastName}`.trim(),
          classLabel: student.classSection
            ? `${student.classSection.grade.name}-${student.classSection.name}`
            : null,
          rollNo: student.rollNo,
          admissionNo: student.admissionNo,
          code: student.code,
          dob: student.dob ? student.dob.toISOString().slice(0, 10) : null,
          gender: student.gender,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          isActive: student.isActive,
          onRollSince: student.createdAt.toISOString().slice(0, 10),
        },
        attendance: {
          present,
          total,
          pct: total > 0 ? Math.round((present / total) * 100) : null,
          last20: last20
            .reverse() // oldest first for the strip
            .map((a) => ({
              date: a.date.toISOString().slice(0, 10),
              status: a.status as 'PRESENT' | 'ABSENT' | 'LATE',
            })),
        },
        fees,
        documents: documents.map((d) => {
          assertPressDocType(d.type);
          return {
            id: d.id,
            type: d.type,
            serial: d.serial,
            issuedAt: d.issuedAt.toISOString(),
            voided: d.voidedAt !== null,
          };
        }),
        library: library.map((l) => ({
          title: l.copy.title.title,
          issuedOn: l.issuedOn.toISOString().slice(0, 10),
          dueOn: l.dueOn.toISOString().slice(0, 10),
          returnedOn: l.returnedOn ? l.returnedOn.toISOString().slice(0, 10) : null,
        })),
      };
    });

    // Outside the tenant transaction above: each opens its own (short ones,
    // the Supabase 5-second rule).
    const [academics, school] = await Promise.all([
      this.press.compileForStudent(schoolId, studentId),
      withTenant(schoolId, (tx) => this.press.schoolHeader(tx, schoolId)),
    ]);

    return { ...base, academics, school };
  }
}
