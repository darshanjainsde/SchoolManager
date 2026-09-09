import type { StudentStatus, TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';

export type LeaveStatus = Extract<StudentStatus, 'ALUMNI' | 'TRANSFERRED' | 'LEFT'>;

export interface StudentLeaveInput {
  schoolId: string;
  actorUserId: string;
  studentId: string;
  status: LeaveStatus;
  leftOn: Date;
  reason?: string | null;
  note?: string | null;
  /** ALUMNI only. Defaults to the current academic year's name. */
  alumniBatch?: string | null;
}

/**
 * The single write that takes a student out of the active roster.
 *
 * Pure transaction function so the Sessions "Start" (Track C) can run hundreds
 * of these inside ONE transaction. Login closure is the caller's job, after
 * commit (see internal/close-login.ts). `classSectionId` is deliberately kept:
 * it is the child's last class, and every roster filters on status instead.
 */
export async function applyStudentLeave(
  tx: TenantTx,
  input: StudentLeaveInput,
): Promise<{ userId: string | null; status: LeaveStatus }> {
  const s = await tx.student.findFirst({
    where: { schoolId: input.schoolId, id: input.studentId },
    select: { id: true, userId: true, status: true },
  });
  if (!s) throw new ApiError('NOT_FOUND', 'Student not found', 404);
  if (s.status !== 'ACTIVE') throw new ApiError('NOT_ACTIVE', 'This student is not active', 409, 'status');

  let alumniBatch: string | null = null;
  if (input.status === 'ALUMNI') {
    alumniBatch = input.alumniBatch?.trim() || null;
    if (!alumniBatch) {
      const year = await tx.academicYear.findFirst({
        where: { schoolId: input.schoolId, isCurrent: true },
        select: { name: true },
      });
      alumniBatch = year?.name ?? null;
    }
  }

  await tx.student.update({
    where: { id: input.studentId },
    data: {
      status: input.status,
      isActive: false,
      leftOn: input.leftOn,
      leftReason: input.reason?.trim() || null,
      leftNote: input.note?.trim() || null,
      alumniBatch,
      statusChangedAt: new Date(),
      statusChangedById: input.actorUserId,
    },
  });
  return { userId: s.userId, status: input.status };
}

export async function applyStudentReadmit(
  tx: TenantTx,
  input: { schoolId: string; actorUserId: string; studentId: string; classSectionId?: string | null },
): Promise<{ userId: string | null; code: string | null }> {
  const s = await tx.student.findFirst({
    where: { schoolId: input.schoolId, id: input.studentId },
    select: { id: true, userId: true, status: true, code: true },
  });
  if (!s) throw new ApiError('NOT_FOUND', 'Student not found', 404);
  if (s.status === 'ACTIVE') throw new ApiError('ALREADY_ACTIVE', 'This student is already active', 409, 'status');
  if (input.classSectionId) {
    // Client-supplied foreign id: check it against the school explicitly —
    // FK checks bypass RLS.
    const cs = await tx.classSection.findFirst({
      where: { id: input.classSectionId, schoolId: input.schoolId },
      select: { id: true },
    });
    if (!cs) throw new ApiError('VALIDATION', 'classSection not found', 400, 'classSectionId');
  }
  await tx.student.update({
    where: { id: input.studentId },
    data: {
      status: 'ACTIVE',
      isActive: true,
      leftOn: null,
      leftReason: null,
      leftNote: null,
      alumniBatch: null,
      statusChangedAt: new Date(),
      statusChangedById: input.actorUserId,
      ...(input.classSectionId ? { classSectionId: input.classSectionId } : {}),
    },
  });
  return { userId: s.userId, code: s.code };
}

export interface StudentHistoryCounts {
  attendance: number;
  results: number;
  diary: number;
  library: number;
  threads: number;
  hasHistory: boolean;
}

/**
 * What a hard delete would erase. Attendance and Result cascade on delete, so
 * "Remove" used to wipe a child's whole record silently; the delete route now
 * refuses (HAS_HISTORY) when any of these is non-zero.
 */
export async function studentHistoryCounts(tx: TenantTx, studentId: string): Promise<StudentHistoryCounts> {
  const [attendance, results, diaryR, diaryA, library, threads] = await Promise.all([
    tx.attendance.count({ where: { studentId } }),
    tx.result.count({ where: { studentId } }),
    tx.diaryRecipient.count({ where: { studentId } }),
    tx.diaryAck.count({ where: { studentId } }),
    tx.libraryIssue.count({ where: { studentId } }),
    tx.messageThread.count({ where: { studentId } }),
  ]);
  const diary = diaryR + diaryA;
  return {
    attendance,
    results,
    diary,
    library,
    threads,
    hasHistory: attendance + results + diary + library + threads > 0,
  };
}
