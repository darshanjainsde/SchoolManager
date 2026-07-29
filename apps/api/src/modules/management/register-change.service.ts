import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { AuditService } from '../../common/audit/audit.service';
import { ApiError } from '../../common/errors/api-error';
import { requireClassAccess } from './internal/class-access';
import type { CreateRegisterChangeDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface RegisterChangeRow {
  id: string;
  classSectionId: string;
  className: string;
  date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByTeacherId: string;
  requestedByName: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Admin-side detail — the reviewer's own User.id. No client screen renders it; kept here rather than widened onto every row consumer. */
  reviewedByUserId: string | null;
}

/**
 * An approval is good until the end of the approving day, IST. Time-boxing it
 * means the lock reasserts itself on its own — an admin never has to remember
 * to revoke an unlock, and a forgotten approval cannot leave a register
 * editable indefinitely.
 */
function endOfIstDay(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

/**
 * The request/review lifecycle around a locked register (see
 * `AttendanceService.save`'s past-day lock). A teacher files a
 * `RegisterChangeRequest` explaining why a closed day needs reopening; a
 * SCHOOL_ADMIN approves or rejects it. Approval is the ONLY thing that ever
 * sets `expiresAt` — a PENDING row always has a null `expiresAt` and must
 * never be treated as an unlock (see `AttendanceService.save`'s comment on
 * why the unlock lookup requires `status: 'APPROVED'` explicitly rather than
 * trusting `expiresAt` alone).
 */
@Injectable()
export class RegisterChangeService {
  constructor(private readonly audit: AuditService) {}

  /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
  private requireTeacherFor(tx: Tx, userId: string, classSectionId: string, date: string) {
    return requireClassAccess(tx, userId, classSectionId, date, 'request changes to');
  }

  private static readonly ROW_INCLUDE = {
    classSection: { select: { name: true, grade: { select: { name: true } } } },
  } as const;

  private static toRow(
    r: {
      id: string;
      classSectionId: string;
      date: Date;
      reason: string;
      status: string;
      requestedByTeacherId: string;
      reviewedAt: Date | null;
      expiresAt: Date | null;
      createdAt: Date;
      classSection?: { name: string; grade: { name: string } } | null;
      reviewedByUserId?: string | null;
    },
    requestedByName: string | null = null,
  ): RegisterChangeRow {
    return {
      id: r.id,
      classSectionId: r.classSectionId,
      className: r.classSection ? `${r.classSection.grade.name}-${r.classSection.name}` : '',
      date: r.date.toISOString().slice(0, 10),
      reason: r.reason,
      status: r.status as RegisterChangeRow['status'],
      requestedByTeacherId: r.requestedByTeacherId,
      requestedByName,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      reviewedByUserId: r.reviewedByUserId ?? null,
    };
  }

  async request(schoolId: string, userId: string, dto: CreateRegisterChangeDto): Promise<RegisterChangeRow> {
    if (!DATE_RE.test(dto.date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new ApiError('VALIDATION', 'Tell your admin why the register needs changing.', 400, 'reason');
    }

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);

      // One open request per class+date. A second one would give the admin two
      // identical rows to review and two unlocks to reason about.
      const open = await tx.registerChangeRequest.findFirst({
        where: { classSectionId: dto.classSectionId, date: new Date(dto.date), status: 'PENDING' },
        select: { id: true },
      });
      if (open) {
        throw new ApiError(
          'REGISTER_CHANGE_OPEN',
          'You already have a request open for that day.',
          409,
          'date',
        );
      }

      const row = await tx.registerChangeRequest.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          date: new Date(dto.date),
          requestedByTeacherId: teacherId,
          reason,
          status: 'PENDING',
        },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      return RegisterChangeService.toRow(row);
    });
  }

  async mine(schoolId: string, userId: string): Promise<RegisterChangeRow[]> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) return [];
      const rows = await tx.registerChangeRequest.findMany({
        where: { requestedByTeacherId: teacher.id },
        orderBy: { createdAt: 'desc' },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      return rows.map((r) => RegisterChangeService.toRow(r));
    });
  }

  async pending(schoolId: string): Promise<RegisterChangeRow[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.registerChangeRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      const teacherIds = [...new Set(rows.map((r) => r.requestedByTeacherId))];
      const teachers = teacherIds.length
        ? await tx.teacher.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const names = new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));
      return rows.map((r) =>
        RegisterChangeService.toRow(r, names.get(r.requestedByTeacherId) ?? null),
      );
    });
  }

  async review(
    schoolId: string,
    reviewerUserId: string,
    id: string,
    approve: boolean,
  ): Promise<RegisterChangeRow> {
    const row = await withTenant(schoolId, async (tx) => {
      const existing = await tx.registerChangeRequest.findFirst({ where: { id } });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'That request no longer exists.', 404, 'id');
      }
      if (existing.status !== 'PENDING') {
        throw new ApiError(
          'REGISTER_CHANGE_DECIDED',
          'That request has already been decided.',
          409,
          'status',
        );
      }
      return tx.registerChangeRequest.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          expiresAt: approve ? endOfIstDay() : null,
        },
        include: RegisterChangeService.ROW_INCLUDE,
      });
    });

    await this.audit.record({
      schoolId,
      actorUserId: reviewerUserId,
      action: approve ? 'REGISTER_CHANGE_APPROVED' : 'REGISTER_CHANGE_REJECTED',
      entity: 'RegisterChangeRequest',
      entityId: id,
      meta: {
        classSectionId: row.classSectionId,
        date: row.date.toISOString().slice(0, 10),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      },
    });

    return RegisterChangeService.toRow(row);
  }
}
