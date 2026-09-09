import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { AuditService } from '../../common/audit/audit.service';
import { LoginInviteService } from './internal/login-invite.service';
import { closeLoginIn, reopenLoginIn } from './internal/close-login';
import { applyStudentLeave, applyStudentReadmit, studentHistoryCounts } from './internal/student-transitions';
import type { LeaveStudentDto, ReadmitStudentDto } from './management.dto';

/**
 * What the office sees before it confirms "Mark as left". Warn, never block —
 * the same rule the leave policy follows.
 */
export interface StudentClearance {
  libraryIssuesOut: number;
  /** Library fines still DUE, in rupees. */
  finesDueRupees: number;
  /** Fee ledger balance in rupees (0 when the school has no fee ledger) — the
   *  same DEBIT − CREDIT the Press reads before it prints a TC. */
  feeDuesRupees: number;
  /** Red-ink diary remarks the family has not signed. */
  unsignedRemarks: number;
  /** True when a hard delete would erase attendance/results/diary/library/messages. */
  hasHistory: boolean;
}

/**
 * The student half of the person lifecycle (Active Roster, Track A).
 *
 * "Mark as left" replaces Delete: the record and every row under it stay, the
 * child leaves every roster from today, and the login closes. Re-admit brings
 * the same record back. Both are the ONLY writers of `Student.status` and its
 * `isActive` mirror.
 */
@Injectable()
export class StudentLifecycleService {
  constructor(
    private readonly audit: AuditService,
    private readonly invites: LoginInviteService,
  ) {}

  async leave(schoolId: string, actorUserId: string, studentId: string, dto: LeaveStudentDto) {
    const leftOn = new Date(dto.leftOn);
    const { status } = await withTenant(schoolId, async (tx) => {
      const r = await applyStudentLeave(tx, {
        schoolId,
        actorUserId,
        studentId,
        status: dto.status,
        leftOn,
        reason: dto.reason,
        note: dto.note,
        alumniBatch: dto.alumniBatch,
      });
      // A child's login ends with their time at the school — in the same
      // transaction as the row, so the two can never disagree. Alumni get the
      // Homecoming door instead (Track C); never a child's account kept open.
      if (r.userId) await closeLoginIn(tx, schoolId, r.userId);
      return r;
    });
    await this.audit.record({
      schoolId,
      actorUserId,
      action: 'student.leave',
      entity: 'Student',
      entityId: studentId,
      meta: { status, leftOn: dto.leftOn, reason: dto.reason ?? null },
    });
    return { id: studentId, status, leftOn: dto.leftOn };
  }

  async readmit(schoolId: string, actorUserId: string, studentId: string, dto: ReadmitStudentDto) {
    const { userId, code } = await withTenant(schoolId, async (tx) => {
      const r = await applyStudentReadmit(tx, { schoolId, actorUserId, studentId, classSectionId: dto.classSectionId });
      if (r.userId) await reopenLoginIn(tx, schoolId, r.userId);
      return r;
    });
    if (userId) {
      // Sessions were revoked on leaving; a fresh set-password link is the only way back in.
      await this.invites.sendInvite(userId, code ?? '');
    }
    await this.audit.record({
      schoolId,
      actorUserId,
      action: 'student.readmit',
      entity: 'Student',
      entityId: studentId,
      meta: { classSectionId: dto.classSectionId ?? null },
    });
    return { id: studentId, status: 'ACTIVE' as const };
  }

  async clearance(schoolId: string, studentId: string): Promise<StudentClearance> {
    return withTenant(schoolId, async (tx) => {
      const [issuesOut, fines, remarks, signed, feeDuesMinor, history] = await Promise.all([
        tx.libraryIssue.count({ where: { schoolId, studentId, returnedOn: null } }),
        tx.libraryFine.aggregate({ where: { schoolId, studentId, status: 'DUE' }, _sum: { amountRupees: true } }),
        tx.diaryRecipient.count({ where: { schoolId, studentId, entry: { kind: 'REMARK' } } }),
        tx.diaryAck.count({ where: { schoolId, studentId, signedAt: { not: null }, entry: { kind: 'REMARK' } } }),
        ledgerBalanceMinor(tx, studentId),
        studentHistoryCounts(tx, studentId),
      ]);
      return {
        libraryIssuesOut: issuesOut,
        finesDueRupees: fines._sum.amountRupees ?? 0,
        feeDuesRupees: Math.max(0, Math.round(feeDuesMinor / 100)),
        unsignedRemarks: Math.max(0, remarks - signed),
        hasHistory: history.hasHistory,
      };
    });
  }
}

/** DEBIT − CREDIT over the child's fee ledger, in minor units (paise). Mirrors
 *  the Press's own reader so a TC and a leave screen never disagree on dues. */
async function ledgerBalanceMinor(tx: TenantTx, studentId: string): Promise<number> {
  const grouped = await tx.feeLedgerEntry.groupBy({
    by: ['kind'],
    where: { studentId },
    _sum: { amountMinor: true },
  });
  const debit = grouped.find((g) => g.kind === 'DEBIT')?._sum.amountMinor ?? 0;
  const credit = grouped.find((g) => g.kind === 'CREDIT')?._sum.amountMinor ?? 0;
  return debit - credit;
}
