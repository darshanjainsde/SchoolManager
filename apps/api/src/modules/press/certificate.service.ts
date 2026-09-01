import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import {
  assertPressDocType,
  type CertificatePrepare,
  type CertificateSnapshot,
  type PressCertificateType,
  type PressDocType,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002 } from '../../common/errors/prisma-errors';
import { ReportCardService, seriesYear } from './report-card.service';
import type { IssueCertificateDto } from './press.dto';

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

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(private readonly reportCards: ReportCardService) {}

  /** Everything the certificate form needs, prefilled from the record. */
  async prepare(schoolId: string, studentId: string): Promise<CertificatePrepare> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId },
        include: { classSection: { include: { grade: { select: { name: true } } } } },
      });
      if (!student) throw new ApiError('NOT_FOUND', 'That student was not found.', 404);

      const [duesMinor, existing] = await Promise.all([
        this.ledgerBalanceMinor(tx, studentId),
        tx.pressIssue.findMany({
          where: { studentId, type: { not: 'REPORT_CARD' } },
          select: { id: true, type: true, serial: true, issuedAt: true },
          orderBy: { issuedAt: 'desc' },
        }),
      ]);

      return {
        student: {
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
        },
        duesMinor,
        existing: existing.map((e) => {
          assertPressDocType(e.type);
          return { id: e.id, type: e.type, serial: e.serial, issuedAt: e.issuedAt.toISOString() };
        }),
      };
    });
  }

  async issue(schoolId: string, dto: IssueCertificateDto, issuedById: string) {
    const type = dto.type as PressCertificateType;
    const prepared = await this.prepare(schoolId, dto.studentId);

    if (DUES_GATED.includes(type) && prepared.duesMinor > 0 && !dto.duesOverride) {
      throw new ApiError(
        'DUES_OUTSTANDING',
        `Fees of ₹${(prepared.duesMinor / 100).toFixed(2)} are still outstanding. Clear them, or issue with an override — the register records both.`,
        409,
        'duesOverride',
      );
    }

    const snapshot: CertificateSnapshot = {
      kind: 'CERTIFICATE',
      type,
      school: await withTenant(schoolId, (tx) => this.reportCards.schoolHeader(tx, schoolId)),
      student: prepared.student,
      fields: {
        conduct: dto.conduct?.trim() || 'good',
        classLabel: dto.classLabel?.trim() || prepared.student.classLabel || '—',
        ...(dto.reason ? { reason: dto.reason.trim() } : {}),
        ...(dto.fromDate ? { fromDate: dto.fromDate } : { fromDate: prepared.student.onRollSince }),
        ...(dto.toDate ? { toDate: dto.toDate } : {}),
        ...(dto.purpose ? { purpose: dto.purpose.trim() } : {}),
        ...(dto.note ? { note: dto.note.trim() } : {}),
      },
      duesMinor: prepared.duesMinor,
      duesOverride: Boolean(dto.duesOverride && prepared.duesMinor > 0),
    };

    const series = `${SERIES_PREFIX[type]}/${seriesYear(new Date())}`;
    try {
      return await withTenant(schoolId, async (tx) => {
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
        return { id: row.id, serial: row.serial, issuedAt: row.issuedAt.toISOString() };
      });
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
