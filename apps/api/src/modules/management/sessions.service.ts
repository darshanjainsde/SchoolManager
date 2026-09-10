import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant, type Prisma, type TenantTx } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isSchemaMissing } from '../../common/errors/prisma-errors';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { activeStudentsWhere } from '../../common/roster/active-students';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { runInBackground } from '../../common/notifications/run-in-background';
import { AlumniAuthService, AlumniService } from '../alumni';
import { FeatureResolverService } from '../features';
import { LeavePolicyService } from './leave-policy.service';
import { applyStudentLeave } from './internal/student-transitions';
import { closeLoginIn } from './internal/close-login';
import {
  PASS_OUT,
  assignRollNumbers,
  attendancePct,
  defaultSectionMap,
  gradeLadder,
  resultsPct,
  startOfDayInZone,
  type RollPolicy,
  type SectionMap,
} from './internal/session-maths';
import type {
  CreateSessionPlanDto,
  PutDecisionsDto,
  SessionStudentRow,
  StartSessionDto,
  UpdateSessionPlanDto,
} from './sessions.dto';

/**
 * Sessions — the year end (Active Roster, Track C). Spec §4.
 *
 * A plan is a DRAFT the office edits over days: open the next year, copy the
 * classes, decide every child, review, start. Nothing about a child changes
 * until Start, and Start is ONE transaction: seats move, the passing-out
 * classes graduate through the Homecoming wing, leavers go through Track A's
 * applyStudentLeave, the current year flips, the timetable copies, pending
 * register requests close, and every leaver's login closes — all or nothing.
 * Leave carry-forward, the inbox rows and the emails run after commit and
 * are best-effort by design (a mail outage must not undo a promotion).
 *
 * Stateless: attendance % and results % are computed on read; the only state
 * is the plan and its decision rows.
 */

const OPEN = ['DRAFT', 'SCHEDULED'] as const;
type PlanKind = Prisma.SessionPlanGetPayload<{ include: { fromYear: true; toYear: true } }>;

export interface StartOutcome {
  moved: number;
  alumni: number;
  left: number;
  slotsCopied: number;
  slotsSkipped: number;
  alumniDoor: boolean;
  alumniStudentIds: string[];
  teacherUserIds: string[];
  familyUserIds: { userId: string; firstName: string; className: string }[];
  sessionName: string;
  schoolName: string;
  schoolSlug: string;
  carryLeave: boolean;
  fromYearId: string;
  toYearId: string;
}

export interface RegisterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  fromSection: string | null;
  toSection: string | null;
  decision: string;
  leaveStatus: string | null;
  decidedBy: string | null;
  appliedAt: string | null;
}

function groupBy<T extends { studentId: string }>(xs: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const list = m.get(x.studentId);
    if (list) list.push(x);
    else m.set(x.studentId, [x]);
  }
  return m;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly audit: AuditService,
    private readonly leavePolicy: LeavePolicyService,
    private readonly alumni: AlumniService,
    private readonly alumniAuth: AlumniAuthService,
    private readonly features: FeatureResolverService,
    private readonly mail: MailService,
  ) {}

  private openPlan(tx: TenantTx, schoolId: string): Promise<PlanKind | null> {
    return tx.sessionPlan.findFirst({
      where: { schoolId, status: { in: [...OPEN] } },
      include: { fromYear: true, toYear: true },
    });
  }

  private async editablePlan(tx: TenantTx, schoolId: string): Promise<PlanKind> {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
    if (plan.status !== 'DRAFT') {
      throw new ApiError('PLAN_LOCKED', 'A scheduled plan cannot be edited. Cancel the schedule first.', 409);
    }
    return plan;
  }

  // ── Plan lifecycle ────────────────────────────────────────────────────────

  /** The Sessions tab's first screen: every year with its size, and the open plan if any. */
  async overview(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [years, sections, counts] = await Promise.all([
        tx.academicYear.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId },
          orderBy: { startDate: 'asc' },
          include: { _count: { select: { classSections: true } } },
        }),
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, academicYearId: true } }),
        tx.student.groupBy({ by: ['classSectionId'], where: activeStudentsWhere(schoolId), _count: { _all: true } }),
      ]);
      const bySection = new Map(counts.map((c) => [c.classSectionId, c._count._all]));
      const perYear = new Map<string, number>();
      for (const s of sections) perYear.set(s.academicYearId, (perYear.get(s.academicYearId) ?? 0) + (bySection.get(s.id) ?? 0));

      // Degrades until the session_plans migration lands (Global Constraints).
      let plan: PlanKind | null = null;
      try {
        plan = await this.openPlan(tx, schoolId);
      } catch (e) {
        if (!isSchemaMissing(e)) throw e;
      }
      return {
        years: years.map((y) => ({
          id: y.id,
          name: y.name,
          startDate: y.startDate,
          endDate: y.endDate,
          isCurrent: y.isCurrent,
          sections: y._count.classSections,
          students: perYear.get(y.id) ?? 0,
        })),
        plan,
      };
    });
  }

  async createPlan(schoolId: string, actorUserId: string, dto: CreateSessionPlanDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (!(endDate > startDate)) throw new ApiError('VALIDATION', 'The session must end after it starts', 400, 'endDate');
    const name = dto.name.trim();
    const plan = await withTenant(schoolId, async (tx) => {
      if (await this.openPlan(tx, schoolId)) {
        throw new ApiError('PLAN_OPEN', 'A new-session plan is already open. Finish or cancel it first.', 409);
      }
      const from = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
      if (!from) throw new ApiError('NO_CURRENT_YEAR', 'Mark the current academic year first (Settings → Academic years).', 400);
      let to = await tx.academicYear.findUnique({ where: { schoolId_name: { schoolId, name } } });
      if (!to) {
        try {
          to = await tx.academicYear.create({ data: { schoolId, name, startDate, endDate, isCurrent: false } });
        } catch (e) {
          if (isP2002(e)) throw new ApiError('YEAR_EXISTS', 'An academic year with that name already exists', 409, 'name');
          throw e;
        }
      }
      if (to.id === from.id) throw new ApiError('SAME_YEAR', 'The next session must be a different year', 400, 'name');
      return tx.sessionPlan.create({
        data: { schoolId, fromYearId: from.id, toYearId: to.id, createdById: actorUserId },
        include: { fromYear: true, toYear: true },
      });
    });
    await this.audit.record({
      schoolId, actorUserId, action: 'session.plan.create', entity: 'SessionPlan', entityId: plan.id,
      meta: { from: plan.fromYear.name, to: plan.toYear.name },
    });
    return plan;
  }

  async getPlan(schoolId: string) {
    return withTenant(schoolId, (tx) => this.openPlan(tx, schoolId));
  }

  async updatePlan(schoolId: string, dto: UpdateSessionPlanDto) {
    if (dto.sectionMap) {
      for (const [k, v] of Object.entries(dto.sectionMap)) {
        if (typeof v !== 'string' || !k) throw new ApiError('VALIDATION', 'Section map values must be a section id or PASS_OUT', 400, 'sectionMap');
      }
    }
    return withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const { sectionMap, ...rest } = dto;
      return tx.sessionPlan.update({
        where: { id: plan.id },
        data: { ...rest, ...(sectionMap ? { sectionMap: sectionMap as Prisma.InputJsonValue } : {}), version: { increment: 1 } },
        include: { fromYear: true, toYear: true },
      });
    });
  }

  async cancel(schoolId: string, actorUserId: string) {
    const id = await withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      await tx.sessionPlan.update({ where: { id: plan.id }, data: { status: 'CANCELLED', scheduledFor: null } });
      return plan.id;
    });
    await this.audit.record({ schoolId, actorUserId, action: 'session.plan.cancel', entity: 'SessionPlan', entityId: id, meta: null });
    return { cancelled: true as const };
  }

  // ── Step 2: the classes ───────────────────────────────────────────────────

  /**
   * Copies the closing year's sections into the next year (same grade, same
   * name; class teachers only if still ACTIVE) and proposes the section map.
   * Idempotent: sections that already exist are kept, never duplicated.
   */
  async copyStructure(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const ladder = gradeLadder(await tx.grade.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, order: true } }));
      if (!ladder.ok) {
        throw new ApiError('GRADE_ORDER', 'Set a unique order for every grade first (Classes → Structure).', 400);
      }
      const from = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: plan.fromYearId },
        select: { id: true, gradeId: true, name: true, classTeacherId: true, classTeacher: { select: { status: true } } },
      });
      const existing = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: plan.toYearId },
        select: { gradeId: true, name: true },
      });
      const have = new Set(existing.map((e) => `${e.gradeId}|${e.name.toLowerCase()}`));
      let created = 0;
      for (const f of from) {
        if (have.has(`${f.gradeId}|${f.name.toLowerCase()}`)) continue;
        await tx.classSection.create({
          data: {
            schoolId, gradeId: f.gradeId, name: f.name, academicYearId: plan.toYearId,
            classTeacherId: f.classTeacher?.status === 'ACTIVE' ? f.classTeacherId : null,
          },
        });
        created++;
      }
      const to = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: plan.toYearId },
        select: { id: true, gradeId: true, name: true, classTeacherId: true },
      });
      const sectionMap = defaultSectionMap(from, to, ladder.ordered);
      await tx.sessionPlan.update({ where: { id: plan.id }, data: { sectionMap: sectionMap as Prisma.InputJsonValue, version: { increment: 1 } } });
      return {
        created,
        existing: existing.length,
        sectionsWithoutClassTeacher: to.filter((t) => !t.classTeacherId).map((t) => t.id),
        sectionMap,
      };
    });
  }

  // ── Step 3: the children ──────────────────────────────────────────────────

  /** One closing class (or the children with no class) with the numbers beside each name. */
  async sectionRows(schoolId: string, sectionId: string) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      const unplaced = sectionId === 'UNPLACED';
      const section = unplaced
        ? null
        : await tx.classSection.findFirst({
            where: { id: sectionId, schoolId, academicYearId: plan.fromYearId },
            select: { id: true, gradeId: true, name: true, grade: { select: { name: true } } },
          });
      if (!unplaced && !section) throw new ApiError('NOT_FOUND', 'Class not found in the closing session', 404);

      const targetsRaw = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: plan.toYearId },
        select: { id: true, gradeId: true, name: true, grade: { select: { name: true } } },
        orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
      });
      const targets = targetsRaw.map((t) => ({ id: t.id, label: `${t.grade.name} ${t.name}`, gradeId: t.gradeId }));
      const map = (plan.sectionMap ?? {}) as SectionMap;
      const defaultTo = section ? (map[section.id] ?? null) : null;
      const stayTo = section ? (targets.find((t) => t.gradeId === section.gradeId)?.id ?? null) : null;

      const students = await tx.student.findMany({
        take: LIST_CEILING.ROSTER,
        where: activeStudentsWhere(schoolId, { classSectionId: unplaced ? null : sectionId }),
        select: { id: true, firstName: true, lastName: true, admissionNo: true, rollNo: true, createdAt: true },
        orderBy: [{ rollNo: 'asc' }, { firstName: 'asc' }],
      });
      const ids = students.map((s) => s.id);
      const examsRaw = section
        ? await tx.exam.findMany({
            take: LIST_CEILING.ACTIVITY,
            where: { schoolId, classSectionId: section.id },
            select: { id: true, title: true, maxMarks: true, scheduledAt: true },
            orderBy: { scheduledAt: 'asc' },
          })
        : [];
      const countIds = plan.countExamIds.length ? new Set(plan.countExamIds) : null;
      const examIds = examsRaw.map((e) => e.id);
      const [marks, results, decisions] = await Promise.all([
        ids.length
          ? tx.attendance.findMany({
              take: LIST_CEILING.ROSTER,
              where: { schoolId, studentId: { in: ids }, date: { gte: plan.fromYear.startDate, lte: plan.fromYear.endDate } },
              select: { studentId: true, status: true },
            })
          : [],
        ids.length && examIds.length
          ? tx.result.findMany({
              take: LIST_CEILING.ROSTER,
              where: { schoolId, studentId: { in: ids }, publishedAt: { not: null }, examId: { in: examIds } },
              select: { studentId: true, marks: true, examId: true, exam: { select: { maxMarks: true } } },
            })
          : [],
        ids.length
          ? tx.sessionDecision.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, planId: plan.id, studentId: { in: ids } } })
          : [],
      ]);
      const marksBy = groupBy(marks.map((m) => ({ studentId: m.studentId, status: m.status as 'PRESENT' | 'ABSENT' | 'LATE' })));
      const resultsBy = groupBy(results.filter((r) => !countIds || countIds.has(r.examId)));
      const decBy = new Map(decisions.map((d) => [d.studentId, d]));

      const rows: SessionStudentRow[] = students.map((s) => {
        const d = decBy.get(s.id);
        const rp = resultsPct((resultsBy.get(s.id) ?? []).map((r) => ({ marks: r.marks, maxMarks: r.exam.maxMarks })));
        return {
          studentId: s.id,
          rollNo: s.rollNo,
          name: `${s.firstName} ${s.lastName}`.trim(),
          admissionNo: s.admissionNo,
          attendancePct: attendancePct(marksBy.get(s.id) ?? []),
          resultsPct: rp,
          review: rp !== null && rp < plan.passMarkPct,
          joinedSincePlan: s.createdAt > plan.createdAt,
          decision: d?.decision ?? null,
          toSectionId: d ? d.toSectionId : defaultTo === PASS_OUT ? null : defaultTo,
          leaveStatus: (d?.leaveStatus as 'TRANSFERRED' | 'LEFT' | null | undefined) ?? null,
          leaveReason: d?.leaveReason ?? null,
          note: d?.note ?? null,
          defaultDecision: defaultTo === PASS_OUT ? 'PASS_OUT' : 'PROMOTE',
          stayToSectionId: stayTo,
        };
      });
      return {
        section: section ? { id: section.id, label: `${section.grade.name} ${section.name}`, gradeId: section.gradeId } : null,
        targets,
        exams: examsRaw.map((e) => ({ id: e.id, title: e.title, maxMarks: e.maxMarks, scheduledAt: e.scheduledAt })),
        rows,
      };
    });
  }

  async upsertDecisions(schoolId: string, actorUserId: string, dto: PutDecisionsDto) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const ids = Array.from(new Set(dto.rows.map((r) => r.studentId)));
      const [valid, known] = await Promise.all([
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, academicYearId: plan.toYearId }, select: { id: true } }),
        ids.length ? tx.student.findMany({ take: LIST_CEILING.ROSTER, where: activeStudentsWhere(schoolId, { id: { in: ids } }), select: { id: true } }) : [],
      ]);
      const validIds = new Set(valid.map((s) => s.id));
      const knownIds = new Set(known.map((s) => s.id));
      for (const r of dto.rows) {
        if (!knownIds.has(r.studentId)) throw new ApiError('NOT_FOUND', 'One of those students is not on the active roll', 404, 'studentId');
        const seated = r.decision === 'PROMOTE' || r.decision === 'STAY';
        if (seated && (!r.toSectionId || !validIds.has(r.toSectionId))) {
          throw new ApiError('BAD_TARGET', 'Pick a class in the next session for every promoted child', 400, 'toSectionId');
        }
        if (r.decision === 'LEAVE' && !r.leaveStatus) throw new ApiError('VALIDATION', 'Leaving needs a reason type', 400, 'leaveStatus');
        const data = {
          decision: r.decision,
          toSectionId: seated ? r.toSectionId! : null,
          leaveStatus: r.decision === 'LEAVE' ? r.leaveStatus! : null,
          leaveReason: r.leaveReason?.trim() || null,
          note: r.note?.trim() || null,
          decidedById: actorUserId,
        };
        await tx.sessionDecision.upsert({
          where: { planId_studentId: { planId: plan.id, studentId: r.studentId } },
          update: data,
          create: { schoolId, planId: plan.id, studentId: r.studentId, ...data },
        });
      }
      const updated = await tx.sessionPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } }, select: { version: true } });
      return { saved: dto.rows.length, version: updated.version };
    });
  }

  // ── Step 4/5: review and Start ────────────────────────────────────────────

  async review(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      const closing = await tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, academicYearId: plan.fromYearId }, select: { id: true } });
      const closingIds = closing.map((c) => c.id);
      const [students, decisions, toSections, newAdmissions, issues] = await Promise.all([
        tx.student.findMany({
          take: LIST_CEILING.ROSTER,
          where: activeStudentsWhere(schoolId, { OR: [{ classSectionId: { in: closingIds } }, { classSectionId: null }] }),
          select: { id: true, classSectionId: true },
        }),
        tx.sessionDecision.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, planId: plan.id } }),
        tx.classSection.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId, academicYearId: plan.toYearId },
          select: { id: true, classTeacherId: true, name: true, grade: { select: { name: true } } },
        }),
        tx.student.count({ where: activeStudentsWhere(schoolId, { classSection: { academicYearId: plan.toYearId } }) }),
        tx.libraryIssue.count({ where: { schoolId, returnedOn: null, student: { status: 'ACTIVE' } } }),
      ]);
      const decBy = new Map(decisions.map((d) => [d.studentId, d]));
      const counts = { promote: 0, stay: 0, passOut: 0, leave: 0, newAdmissions, unplaced: 0, undecided: 0 };
      const passOutIds: string[] = [];
      for (const s of students) {
        const d = decBy.get(s.id);
        if (!d) {
          if (s.classSectionId === null) counts.unplaced++;
          else counts.undecided++;
          continue;
        }
        if (d.decision === 'PROMOTE') counts.promote++;
        else if (d.decision === 'STAY') counts.stay++;
        else if (d.decision === 'PASS_OUT') {
          counts.passOut++;
          passOutIds.push(s.id);
        } else counts.leave++;
      }
      const alumniWithoutEmail = passOutIds.length
        ? await tx.student.count({ where: { schoolId, id: { in: passOutIds }, OR: [{ email: null }, { email: '' }] } })
        : 0;
      return {
        counts,
        alumniWithoutEmail,
        libraryIssuesOut: issues,
        sectionsWithoutClassTeacher: toSections.filter((t) => !t.classTeacherId).map((t) => `${t.grade.name} ${t.name}`),
        version: plan.version,
        status: plan.status,
        scheduledFor: plan.scheduledFor,
        copyTimetable: plan.copyTimetable,
        carryLeave: plan.carryLeave,
        rollPolicy: plan.rollPolicy,
        fromYear: { id: plan.fromYearId, name: plan.fromYear.name, endDate: plan.fromYear.endDate },
        toYear: { id: plan.toYearId, name: plan.toYear.name, startDate: plan.toYear.startDate },
      };
    });
  }

  async start(schoolId: string, actorUserId: string, dto: StartSessionDto) {
    const gate = await withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      if (plan.version !== dto.version) {
        throw new ApiError('PLAN_CHANGED', 'The plan changed since you opened this page. Reload and review again.', 409);
      }
      return plan;
    });
    if (dto.when === 'ON_START_DATE') {
      const scheduledFor = startOfDayInZone(gate.toYear.startDate, await this.timezone(schoolId));
      await withTenant(schoolId, (tx) => tx.sessionPlan.update({ where: { id: gate.id }, data: { status: 'SCHEDULED', scheduledFor } }));
      await this.audit.record({ schoolId, actorUserId, action: 'session.schedule', entity: 'SessionPlan', entityId: gate.id, meta: { scheduledFor } });
      return { scheduled: true as const, scheduledFor: scheduledFor.toISOString() };
    }
    const outcome = await this.applyPlan(schoolId, actorUserId, gate.id);
    await this.afterStart(schoolId, outcome);
    return {
      started: true as const,
      startedAt: new Date().toISOString(),
      moved: outcome.moved,
      alumni: outcome.alumni,
      left: outcome.left,
      slotsCopied: outcome.slotsCopied,
      slotsSkipped: outcome.slotsSkipped,
    };
  }

  /** The one transaction. Reused by the scheduled start (startDue). */
  private async applyPlan(schoolId: string, actorUserId: string, planId: string): Promise<StartOutcome> {
    const hasAlumniWing = (await this.features.getFeatures(schoolId)).has('ALUMNI');
    const outcome = await withTenant(schoolId, async (tx) => {
      const plan = await tx.sessionPlan.findFirst({
        where: { id: planId, schoolId, status: { in: [...OPEN] } },
        include: { fromYear: true, toYear: true },
      });
      if (!plan) throw new ApiError('NO_PLAN', 'This plan has already been started or cancelled', 409);
      const school = await tx.school.findUnique({ where: { id: schoolId }, select: { name: true, slug: true } });

      const sections = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: { in: [plan.fromYearId, plan.toYearId] } },
        select: { id: true, gradeId: true, name: true, academicYearId: true, classTeacherId: true, grade: { select: { name: true } } },
      });
      const closing = sections.filter((s) => s.academicYearId === plan.fromYearId);
      const next = sections.filter((s) => s.academicYearId === plan.toYearId);
      const nextIds = new Set(next.map((n) => n.id));
      const nextLabel = new Map(next.map((n) => [n.id, `${n.grade.name} ${n.name}`]));

      const students = await tx.student.findMany({
        take: LIST_CEILING.ROSTER,
        where: activeStudentsWhere(schoolId, { classSectionId: { in: closing.map((c) => c.id) } }),
        select: { id: true, userId: true, firstName: true, lastName: true, admissionNo: true, rollNo: true, classSectionId: true },
      });
      const decisions = await tx.sessionDecision.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, planId: plan.id } });
      const decBy = new Map(decisions.map((d) => [d.studentId, d]));
      const undecided = students.filter((s) => !decBy.has(s.id));
      if (undecided.length) {
        throw new ApiError('UNDECIDED_STUDENTS', `${undecided.length} students have no decision yet`, 400);
      }
      // A target section deleted since the decision was saved must not seat a
      // child in a class that no longer exists.
      for (const s of students) {
        const d = decBy.get(s.id)!;
        if ((d.decision === 'PROMOTE' || d.decision === 'STAY') && (!d.toSectionId || !nextIds.has(d.toSectionId))) {
          throw new ApiError('BAD_TARGET', `${s.firstName} ${s.lastName} is promoted into a class that no longer exists. Decide again.`, 400, 'toSectionId');
        }
      }

      const o: StartOutcome = {
        moved: 0, alumni: 0, left: 0, slotsCopied: 0, slotsSkipped: 0, alumniDoor: false,
        alumniStudentIds: [], teacherUserIds: [], familyUserIds: [],
        sessionName: plan.toYear.name, schoolName: school?.name ?? '', schoolSlug: school?.slug ?? '',
        carryLeave: plan.carryLeave, fromYearId: plan.fromYearId, toYearId: plan.toYearId,
      };

      // Alumni first, while the passing-out classes still read as the active
      // roster the Homecoming wing filters on.
      const passOutSections = Array.from(
        new Set(students.filter((s) => decBy.get(s.id)!.decision === 'PASS_OUT').map((s) => s.classSectionId!)),
      );
      if (passOutSections.length && hasAlumniWing) {
        await this.alumni.graduateBatchIn(tx, schoolId, { classSectionIds: passOutSections, batchYear: plan.fromYear.endDate.getUTCFullYear() });
        o.alumniDoor = true;
      }

      // Seats: per destination class, roll numbers by the plan's policy.
      const byTarget = new Map<string, typeof students>();
      for (const s of students) {
        const d = decBy.get(s.id)!;
        if (d.decision === 'PROMOTE' || d.decision === 'STAY') {
          const group = byTarget.get(d.toSectionId!);
          if (group) group.push(s);
          else byTarget.set(d.toSectionId!, [s]);
        }
      }
      for (const [target, group] of byTarget) {
        const rolls = assignRollNumbers(plan.rollPolicy as RollPolicy, group);
        for (const s of group) {
          await tx.student.update({ where: { id: s.id }, data: { classSectionId: target, rollNo: rolls.get(s.id) ?? null } });
          o.moved++;
          if (s.userId) o.familyUserIds.push({ userId: s.userId, firstName: s.firstName, className: nextLabel.get(target) ?? '' });
        }
      }

      // Leavers: Track A's transition, plus the login closing in the same transaction (D9).
      const leftOn = plan.fromYear.endDate;
      for (const s of students) {
        const d = decBy.get(s.id)!;
        if (d.decision === 'PASS_OUT') {
          const r = await applyStudentLeave(tx, { schoolId, actorUserId, studentId: s.id, status: 'ALUMNI', leftOn, alumniBatch: plan.fromYear.name });
          o.alumni++;
          o.alumniStudentIds.push(s.id);
          if (r.userId) await closeLoginIn(tx, schoolId, r.userId);
        } else if (d.decision === 'LEAVE') {
          const r = await applyStudentLeave(tx, {
            schoolId, actorUserId, studentId: s.id, status: (d.leaveStatus ?? 'LEFT') as 'TRANSFERRED' | 'LEFT', leftOn,
            reason: d.leaveReason, note: d.note,
          });
          o.left++;
          if (r.userId) await closeLoginIn(tx, schoolId, r.userId);
        }
        await tx.sessionDecision.update({
          where: { planId_studentId: { planId: plan.id, studentId: s.id } },
          data: { fromSectionId: s.classSectionId, appliedAt: new Date() },
        });
      }

      await tx.academicYear.update({ where: { id: plan.fromYearId }, data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id: plan.toYearId }, data: { isCurrent: true } });

      if (plan.copyTimetable) {
        const key = (s: { gradeId: string; name: string }) => `${s.gradeId}|${s.name.toLowerCase()}`;
        const nextByKey = new Map(next.map((n) => [key(n), n.id]));
        const closingById = new Map(closing.map((c) => [c.id, c]));
        const slots = await tx.timetableSlot.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, academicYearId: plan.fromYearId, effectiveTo: null },
          select: { classSectionId: true, dayOfWeek: true, periodId: true, subjectId: true, teacherId: true, teacher: { select: { status: true, userId: true } } },
        });
        for (const sl of slots) {
          const from = closingById.get(sl.classSectionId);
          const target = from ? nextByKey.get(key(from)) : undefined;
          if (!target || sl.teacher.status !== 'ACTIVE') {
            o.slotsSkipped++;
            continue;
          }
          await tx.timetableSlot.create({
            data: {
              schoolId, classSectionId: target, dayOfWeek: sl.dayOfWeek, periodId: sl.periodId, subjectId: sl.subjectId,
              teacherId: sl.teacherId, academicYearId: plan.toYearId, effectiveFrom: plan.toYear.startDate,
            },
          });
          o.slotsCopied++;
          if (sl.teacher.userId) o.teacherUserIds.push(sl.teacher.userId);
        }
      }

      await tx.registerChangeRequest.updateMany({
        where: { schoolId, classSectionId: { in: closing.map((c) => c.id) }, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: actorUserId },
      });
      await tx.sessionPlan.update({ where: { id: plan.id }, data: { status: 'STARTED', startedAt: new Date(), startedById: actorUserId } });
      return o;
    });

    // After commit, best-effort: unused leave carries into the new year.
    if (outcome.carryLeave) {
      try {
        await this.leavePolicy.closeYear(schoolId, outcome.fromYearId, outcome.toYearId);
      } catch (e) {
        this.logger.warn(`leave carry-forward after session start failed for ${schoolId}: ${(e as Error).message}`);
      }
    }
    await this.audit.record({
      schoolId, actorUserId, action: 'session.start', entity: 'SessionPlan', entityId: planId,
      meta: { moved: outcome.moved, alumni: outcome.alumni, left: outcome.left, slotsCopied: outcome.slotsCopied, slotsSkipped: outcome.slotsSkipped },
    });
    return outcome;
  }

  /**
   * After commit: the bell for every moved family and every teacher with a
   * copied class (one transaction, cheap), then the emails in the background —
   * "your child is in 6 A" to families, and the alumni door (a claim link, the
   * credential itself) to every new alumnus with an address.
   */
  private async afterStart(schoolId: string, o: StartOutcome): Promise<void> {
    const session = o.sessionName;
    await withTenant(schoolId, async (tx) => {
      for (const f of o.familyUserIds) {
        await emitNotifications(tx, {
          schoolId, userIds: [f.userId], kind: 'SESSION',
          title: `${f.firstName} is in ${f.className} for ${session}`,
          body: 'The new class, timetable and diary are ready.',
          linkType: 'home', linkId: null,
        });
      }
      const teachers = Array.from(new Set(o.teacherUserIds));
      if (teachers.length) {
        await emitNotifications(tx, {
          schoolId, userIds: teachers, kind: 'SESSION',
          title: `Session ${session} has started`,
          body: 'Your classes and timetable for the new session are ready.',
          linkType: 'today', linkId: null,
        });
      }
    });

    runInBackground(
      async () => {
        if (o.familyUserIds.length) {
          const users = await withTenant(schoolId, (tx) =>
            tx.user.findMany({
              take: LIST_CEILING.ROSTER,
              where: { schoolId, id: { in: o.familyUserIds.map((f) => f.userId) } },
              select: { id: true, email: true },
            }),
          );
          const email = new Map(users.map((u) => [u.id, u.email]));
          for (const f of o.familyUserIds) {
            const to = email.get(f.userId);
            if (to) await this.mail.sendSessionStarted(to, o.schoolName, f.firstName, f.className, session, schoolId);
          }
        }
        if (o.alumniDoor && o.alumniStudentIds.length) {
          const rows = await withTenant(schoolId, (tx) =>
            tx.alumni.findMany({
              take: LIST_CEILING.ROSTER,
              where: { schoolId, studentId: { in: o.alumniStudentIds }, email: { not: null } },
              select: { id: true, email: true },
            }),
          );
          for (const a of rows) {
            if (!a.email) continue;
            try {
              const { token } = await this.alumniAuth.mintClaimToken(schoolId, a.id);
              const claimUrl = `https://${o.schoolSlug}.${this.env.PLATFORM_HOST}/alumni#claim=${token}`;
              await this.mail.sendAlumniWelcome(a.email, o.schoolName, claimUrl, schoolId);
            } catch (e) {
              this.logger.warn(`alumni claim mail for ${a.id} failed: ${(e as Error).message}`);
            }
          }
        }
      },
      (e) => this.logger.error(`session-start mail for ${schoolId} failed: ${(e as Error).message}`),
    );
  }

  private async timezone(schoolId: string): Promise<string> {
    const s = await withTenant(schoolId, (tx) => tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }));
    return s?.timezone ?? 'Asia/Kolkata';
  }

  // ── After: the register, the cron ─────────────────────────────────────────

  /** The promotion register for a closed year: every child and what happened to them. */
  async register(schoolId: string, yearId: string): Promise<RegisterRow[]> {
    return withTenant(schoolId, async (tx) => {
      const plan = await tx.sessionPlan.findFirst({ where: { schoolId, fromYearId: yearId, status: 'STARTED' } });
      if (!plan) return [];
      const [rows, sections] = await Promise.all([
        tx.sessionDecision.findMany({
          take: LIST_CEILING.ROSTER,
          where: { schoolId, planId: plan.id },
          include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
          orderBy: { updatedAt: 'asc' },
        }),
        tx.classSection.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId, academicYearId: { in: [plan.fromYearId, plan.toYearId] } },
          select: { id: true, name: true, grade: { select: { name: true } } },
        }),
      ]);
      const label = new Map(sections.map((s) => [s.id, `${s.grade.name} ${s.name}`]));
      const deciderIds = Array.from(new Set(rows.map((r) => r.decidedById)));
      const users = deciderIds.length
        ? await tx.user.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: deciderIds } }, select: { id: true, email: true } })
        : [];
      const email = new Map(users.map((u) => [u.id, u.email]));
      return rows.map((r) => ({
        studentId: r.studentId,
        name: `${r.student.firstName} ${r.student.lastName}`.trim(),
        admissionNo: r.student.admissionNo,
        fromSection: r.fromSectionId ? (label.get(r.fromSectionId) ?? null) : null,
        toSection: r.toSectionId ? (label.get(r.toSectionId) ?? null) : null,
        decision: r.decision,
        leaveStatus: r.leaveStatus,
        decidedBy: email.get(r.decidedById) ?? null,
        appliedAt: r.appliedAt?.toISOString() ?? null,
      }));
    });
  }

  /** The cron: every SCHEDULED plan whose start day has come, started by the person who scheduled it. */
  async startDue(now: Date = new Date()): Promise<{ started: string[] }> {
    const due = await getPlatformPrisma().sessionPlan.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      select: { id: true, schoolId: true, createdById: true },
      take: 50,
    });
    const started: string[] = [];
    for (const p of due) {
      try {
        const outcome = await this.applyPlan(p.schoolId, p.createdById, p.id);
        await this.afterStart(p.schoolId, outcome);
        started.push(p.id);
      } catch (e) {
        this.logger.error(`scheduled session start for plan ${p.id} failed: ${(e as Error).message}`);
      }
    }
    return { started };
  }
}
