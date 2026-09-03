import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import {
  assertPressDocType,
  type BulkCertificateResult,
  type CertificatePrepare,
  type CertificateSnapshot,
  type PressCertificateType,
  type PressDocType,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002 } from '../../common/errors/prisma-errors';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { ReportCardService, seriesYear } from './report-card.service';
import type { BulkCertificatesDto, IssueCertificateDto } from './press.dto';

/**
 * TC, bonafide and character certificates.
 *
 * The register row is the statutory artefact here — Indian schools keep a
 * serial-numbered TC book that inspectors ask for by name. So issuing writes
 * an immutable `PressIssue` snapshot, reprints render that snapshot with a
 * DUPLICATE stamp (the sheet's job, keyed off a flag the web sends), and
 * nothing is ever edited after the fact. A wrongly-issued certificate is
 * corrected by issuing a fresh one — the register remembers both, which is
 * what a paper book would do.
 *
 * The TC follows the CBSE Examination Bye-laws Annexure-I form verbatim
 * (cbse.gov.in/Byelawsenglish.pdf): 22 numbered fields. The answers live in
 * two places — the student file (parentage, nationality, category, first
 * admission, PEN) and the issue drawer (exam last taken, promotion, NCC,
 * games …). Whatever the drawer supplies FOR THE FILE is saved back to the
 * Student row, so the school types each fact once, ever. A fact nobody has
 * supplied prints as a blank line — a statutory form filled by hand beats a
 * software that invents answers.
 */

/**
 * The one rule with money in it: a Transfer Certificate certifies, among other
 * things, that dues are cleared — so it reads the fee ledger (the ONLY source
 * of a balance in this codebase) and refuses while the child owes, unless the
 * office explicitly overrides. The override is stored in the snapshot: the
 * register remembers the balance AND that somebody chose to look past it.
 */
const DUES_GATED: PressDocType[] = ['TC'];

const SERIES_PREFIX: Record<PressCertificateType, string> = {
  TC: 'TC',
  BONAFIDE: 'BC',
  CHARACTER: 'CC',
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Drawer fields that belong to the student FILE — saved back on issue. */
const RECORD_FACT_KEYS = [
  'fatherName', 'motherName', 'nationality', 'category',
  'firstAdmissionClass', 'previousSchool', 'penId',
] as const;

type StudentRow = {
  id: string; firstName: string; lastName: string; admissionNo: string; rollNo: string | null;
  dob: Date | null; gender: string | null; guardianName: string | null; createdAt: Date;
  fatherName: string | null; motherName: string | null; nationality: string | null;
  category: string | null; firstAdmissionDate: Date | null; firstAdmissionClass: string | null;
  previousSchool: string | null; penId: string | null;
  classSection: { name: string; grade: { name: string } } | null;
};

const STUDENT_SELECT = {
  id: true, firstName: true, lastName: true, admissionNo: true, rollNo: true,
  dob: true, gender: true, guardianName: true, createdAt: true,
  fatherName: true, motherName: true, nationality: true, category: true,
  firstAdmissionDate: true, firstAdmissionClass: true, previousSchool: true, penId: true,
  classSection: { select: { name: true, grade: { select: { name: true } } } },
} as const;

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(private readonly reportCards: ReportCardService) {}

  private toPrepareStudent(student: StudentRow): CertificatePrepare['student'] {
    return {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`.trim(),
      admissionNo: student.admissionNo,
      rollNo: student.rollNo,
      classLabel: student.classSection
        ? `${student.classSection.grade.name}-${student.classSection.name}`
        : null,
      dob: student.dob ? isoDay(student.dob) : null,
      guardianName: student.guardianName,
      gender: student.gender,
      onRollSince: isoDay(student.createdAt),
      fatherName: student.fatherName,
      motherName: student.motherName,
      nationality: student.nationality,
      category: student.category,
      firstAdmissionDate: student.firstAdmissionDate ? isoDay(student.firstAdmissionDate) : null,
      firstAdmissionClass: student.firstAdmissionClass,
      previousSchool: student.previousSchool,
      penId: student.penId,
    };
  }

  /** Working days / present this academic year — prefills Annexure 14–15. */
  private async attendanceThisYear(
    tx: TenantTx,
    studentId: string,
  ): Promise<{ workingDays: number; presentDays: number } | null> {
    const year = await tx.academicYear.findFirst({
      where: { isCurrent: true },
      select: { startDate: true, endDate: true },
    });
    if (!year) return null;
    const rows = await tx.attendance.groupBy({
      by: ['status'],
      where: { studentId, date: { gte: year.startDate, lte: year.endDate } },
      _count: { _all: true },
    });
    if (rows.length === 0) return null;
    let total = 0;
    let present = 0;
    for (const r of rows) {
      total += r._count._all;
      // LATE is "came, late" — a present child, not an absent one.
      if (r.status === 'PRESENT' || r.status === 'LATE') present += r._count._all;
    }
    return { workingDays: total, presentDays: present };
  }

  /** Everything the certificate form needs, prefilled from the record. */
  async prepare(schoolId: string, studentId: string): Promise<CertificatePrepare> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId },
        select: STUDENT_SELECT,
      });
      if (!student) throw new ApiError('NOT_FOUND', 'That student was not found.', 404);

      const [duesMinor, existing, attendance] = await Promise.all([
        this.ledgerBalanceMinor(tx, studentId),
        tx.pressIssue.findMany({
          where: { studentId, type: { not: 'REPORT_CARD' }, voidedAt: null },
          select: { id: true, type: true, serial: true, issuedAt: true },
          orderBy: { issuedAt: 'desc' },
        }),
        this.attendanceThisYear(tx, studentId),
      ]);

      return {
        student: this.toPrepareStudent(student as StudentRow),
        attendance,
        duesMinor,
        existing: existing.map((e) => {
          assertPressDocType(e.type);
          return { id: e.id, type: e.type, serial: e.serial, issuedAt: e.issuedAt.toISOString() };
        }),
      };
    });
  }

  async issue(schoolId: string, dto: IssueCertificateDto, issuedById: string) {
    try {
      return await withTenant(schoolId, (tx) => this.issueOne(tx, schoolId, dto, issuedById));
    } catch (e) {
      // Serial collision cannot happen (the upsert is atomic); a P2002 here
      // would be the serial unique tripping on a counter reset — surface it
      // plainly rather than retrying into the same wall.
      if (isP2002(e)) {
        throw new ApiError('SERIAL_TAKEN', 'A certificate with this serial already exists. Try again.', 409);
      }
      throw e;
    }
  }

  /**
   * One class, one type, one run — TCs for the passing-out class, bonafides
   * for the scholarship season. The issueBatch shape: a SMALL transaction per
   * student, so one child's refusal (dues, an active TC already in the book)
   * skips that child with a reason instead of killing the run. Statutory
   * answers print from the file; a blank fact prints as a blank line.
   */
  async bulkIssue(
    schoolId: string,
    dto: BulkCertificatesDto,
    issuedById: string,
  ): Promise<BulkCertificateResult> {
    const type = dto.type as PressCertificateType;
    const roster = await withTenant(schoolId, (tx) =>
      tx.student.findMany({
        where: {
          classSectionId: dto.classSectionId,
          isActive: true,
          ...(dto.studentIds?.length ? { id: { in: [...new Set(dto.studentIds)] } } : {}),
        },
        select: { id: true, firstName: true, lastName: true, rollNo: true },
        take: LIST_CEILING.STRUCTURE,
      }),
    );
    roster.sort((a, b) => {
      const na = a.rollNo === null || a.rollNo.trim() === '' ? NaN : Number(a.rollNo);
      const nb = b.rollNo === null || b.rollNo.trim() === '' ? NaN : Number(b.rollNo);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });

    const result: BulkCertificateResult = { issued: [], skipped: [] };
    for (const child of roster) {
      const name = `${child.firstName} ${child.lastName}`.trim();
      try {
        const one = await withTenant(schoolId, async (tx) => {
          if (type === 'TC') {
            // A child can hold only one LIVE TC — the register's one-way
            // correction path applies: void the old one, then reissue.
            const active = await tx.pressIssue.findFirst({
              where: { studentId: child.id, type: 'TC', voidedAt: null },
              select: { serial: true },
            });
            if (active) return { skippedFor: `already holds ${active.serial} — void it first to reissue` };
          }
          return this.issueOne(
            tx, schoolId,
            {
              studentId: child.id, type,
              duesOverride: dto.duesOverride,
              conduct: dto.conduct, reason: dto.reason, purpose: dto.purpose, note: dto.note,
            },
            issuedById,
          );
        });
        if ('skippedFor' in one) {
          result.skipped.push({ studentId: child.id, name, reason: one.skippedFor });
        } else {
          result.issued.push({ studentId: child.id, name, serial: one.serial, issuedAt: one.issuedAt, snapshot: one.snapshot });
        }
      } catch (e) {
        if (e instanceof ApiError) {
          const body = e.getResponse() as { code?: string; message?: string };
          result.skipped.push({
            studentId: child.id, name,
            reason: body.code === 'DUES_OUTSTANDING' ? 'fees outstanding' : (body.message ?? 'refused'),
          });
        } else {
          throw e;
        }
      }
    }
    this.logger.log(
      { schoolId, type, classSectionId: dto.classSectionId, issued: result.issued.length, skipped: result.skipped.length },
      'bulk certificates issued',
    );
    return result;
  }

  /**
   * The shared core: dues read, gate, save-back, snapshot and register row in
   * ONE transaction. Reading the balance in an earlier transaction let a
   * DEBIT land in between and the paper then said "dues cleared" off a stale
   * number — the snapshot must be the balance the gate SAW.
   */
  private async issueOne(tx: TenantTx, schoolId: string, dto: IssueCertificateDto, issuedById: string) {
    const type = dto.type as PressCertificateType;
    const series = `${SERIES_PREFIX[type]}/${seriesYear(new Date())}`;

    let student = await tx.student.findFirst({
      where: { id: dto.studentId },
      select: STUDENT_SELECT,
    });
    if (!student) throw new ApiError('NOT_FOUND', 'That student was not found.', 404);

    const duesMinor = await this.ledgerBalanceMinor(tx, dto.studentId);
    if (DUES_GATED.includes(type) && duesMinor > 0 && !dto.duesOverride) {
      throw new ApiError(
        'DUES_OUTSTANDING',
        `Fees of ₹${(duesMinor / 100).toFixed(2)} are still outstanding. Clear them, or issue with an override — the register records both.`,
        409,
        'duesOverride',
      );
    }

    // Save-back: any file fact the drawer supplied joins the student row, so
    // it is typed once ever — the next certificate prefills it.
    const saveBack: Record<string, unknown> = {};
    for (const key of RECORD_FACT_KEYS) {
      const v = dto[key]?.trim();
      if (v && v !== (student[key] ?? '')) saveBack[key] = v;
    }
    if (dto.firstAdmissionDate) {
      const d = new Date(dto.firstAdmissionDate);
      if (!student.firstAdmissionDate || isoDay(student.firstAdmissionDate) !== isoDay(d)) {
        saveBack.firstAdmissionDate = d;
      }
    }
    if (Object.keys(saveBack).length > 0) {
      student = await tx.student.update({
        where: { id: dto.studentId },
        data: saveBack,
        select: STUDENT_SELECT,
      });
    }

    const onRollSince = isoDay(student.createdAt);
    const classLabel = student.classSection
      ? `${student.classSection.grade.name}-${student.classSection.name}`
      : null;
    const snapshot: CertificateSnapshot = {
      kind: 'CERTIFICATE',
      type,
      school: await this.reportCards.schoolHeader(tx, schoolId),
      student: this.toPrepareStudent(student as StudentRow),
      fields: {
        conduct: dto.conduct?.trim() || 'good',
        classLabel: dto.classLabel?.trim() || classLabel || '—',
        ...(dto.reason ? { reason: dto.reason.trim() } : {}),
        ...(dto.fromDate ? { fromDate: dto.fromDate } : { fromDate: onRollSince }),
        ...(dto.toDate ? { toDate: dto.toDate } : {}),
        ...(dto.purpose ? { purpose: dto.purpose.trim() } : {}),
        ...(dto.note ? { note: dto.note.trim() } : {}),
        // Annexure-I answers — printed verbatim, blank when nobody answered.
        ...(dto.examLastTaken ? { examLastTaken: dto.examLastTaken.trim() } : {}),
        ...(dto.failedBefore ? { failedBefore: dto.failedBefore.trim() } : {}),
        ...(dto.subjects ? { subjects: dto.subjects.trim() } : {}),
        ...(dto.qualifiedForPromotion ? { qualifiedForPromotion: dto.qualifiedForPromotion.trim() } : {}),
        ...(dto.promotedToClass ? { promotedToClass: dto.promotedToClass.trim() } : {}),
        ...(dto.feesPaidUpto ? { feesPaidUpto: dto.feesPaidUpto.trim() } : {}),
        ...(dto.feeConcession ? { feeConcession: dto.feeConcession.trim() } : {}),
        ...(dto.workingDays ? { workingDays: dto.workingDays.trim() } : {}),
        ...(dto.presentDays ? { presentDays: dto.presentDays.trim() } : {}),
        ...(dto.nccScout ? { nccScout: dto.nccScout.trim() } : {}),
        ...(dto.games ? { games: dto.games.trim() } : {}),
        ...(dto.dateOfApplication ? { dateOfApplication: dto.dateOfApplication } : {}),
      },
      duesMinor,
      duesOverride: Boolean(dto.duesOverride && duesMinor > 0),
    };

    const [{ press_next_number: seq }] = await tx.$queryRaw<{ press_next_number: number }[]>`
      SELECT press_next_number(${schoolId}::uuid, ${series}::text)`;
    const serial = `${series}/${String(seq).padStart(4, '0')}`;
    const row = await tx.pressIssue.create({
      data: {
        schoolId,
        type,
        serial,
        studentId: dto.studentId,
        payload: snapshot as object,
        issuedById,
      },
      select: { id: true, serial: true, issuedAt: true },
    });
    this.logger.log({ schoolId, studentId: dto.studentId, type, serial }, 'certificate issued');
    return { id: row.id, serial: row.serial, issuedAt: row.issuedAt.toISOString(), snapshot };
  }

  /**
   * DEBIT − CREDIT over `FeeLedgerEntry` — the append-only ledger is the only
   * source of a balance (its own trigger forbids UPDATE/DELETE). Schools that
   * keep fees outside Sckools simply have an empty ledger and a zero balance:
   * their TC gate never engages, which is the correct reading of "we have no
   * record of dues".
   */
  private async ledgerBalanceMinor(tx: TenantTx, studentId: string): Promise<number> {
    const grouped = await tx.feeLedgerEntry.groupBy({
      by: ['kind'],
      where: { studentId },
      _sum: { amountMinor: true },
    });
    const debit = grouped.find((g) => g.kind === 'DEBIT')?._sum.amountMinor ?? 0;
    const credit = grouped.find((g) => g.kind === 'CREDIT')?._sum.amountMinor ?? 0;
    return debit - credit;
  }
}
