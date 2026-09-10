import { Injectable, Logger } from '@nestjs/common';
import { Prisma, getPlatformPrisma, withTenant, type TenantTx } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { assertNotificationKind, assertNotificationOutboxKind } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isSchemaMissing } from '../../common/errors/prisma-errors';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { activeStudentsWhere } from '../../common/roster/active-students';
import { runInBackground } from '../../common/notifications/run-in-background';
import { AlumniAuthService, AlumniService } from '../alumni';
import { FeatureResolverService } from '../features';
import { LeavePolicyService } from './leave-policy.service';
import {
  PASS_OUT,
  assignRollNumbers,
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
 * children graduate through the Homecoming wing, leavers close, the current
 * year flips, the timetable copies, pending register requests close, and every
 * leaver's login closes — all or nothing. Leave carry-forward, the inbox rows
 * and the emails run after commit and are best-effort by design.
 *
 * The transaction is BATCHED, never per child: `withTenant` gives ten seconds,
 * and a 600-child school walked one statement at a time is two thousand round
 * trips through the pooler. Every write below is one statement per group —
 * per destination class, per leave status, one for the logins, one for the
 * timetable — so the whole year end is a few dozen statements whatever the
 * size of the school.
 *
 * Stateless: attendance % and results % are computed on read; the only state
 * is the plan and its decision rows.
 */

const OPEN = ['DRAFT', 'SCHEDULED'] as const;
const CHUNK = 300;
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
  familyUserIds: { userId: string; firstName: string; className: string; stay: boolean }[];
  /** Leavers with an address on record: the passed-out / left letters after commit. */
  leaverMails: { email: string; firstName: string; kind: 'ALUMNI' | 'TRANSFERRED' | 'LEFT' }[];
  sessionName: string;
  schoolName: string;
  schoolHost: string;
  carryLeave: boolean;
  fromYearId: string;
  toYearId: string;
}

export interface RegisterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  email: string | null;
  fromSection: string | null;
  toSection: string | null;
  decision: string;
  leaveStatus: string | null;
  decidedBy: string | null;
  appliedAt: string | null;
}

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
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
        tx.academicYear.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: { startDate: 'asc' } }),
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, academicYearId: true } }),
        tx.student.groupBy({ by: ['classSectionId'], where: activeStudentsWhere(schoolId), _count: { _all: true } }),
      ]);
      const bySection = new Map(counts.map((c) => [c.classSectionId, c._count._all]));
      const studentsPerYear = new Map<string, number>();
      const sectionsPerYear = new Map<string, number>();
      for (const s of sections) {
        sectionsPerYear.set(s.academicYearId, (sectionsPerYear.get(s.academicYearId) ?? 0) + 1);
        studentsPerYear.set(s.academicYearId, (studentsPerYear.get(s.academicYearId) ?? 0) + (bySection.get(s.id) ?? 0));
      }

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
          sections: sectionsPerYear.get(y.id) ?? 0,
          students: studentsPerYear.get(y.id) ?? 0,
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
    return withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const data: Prisma.SessionPlanUpdateInput = { version: { increment: 1 } };
      if (dto.passMarkPct !== undefined) data.passMarkPct = dto.passMarkPct;
      if (dto.countExamIds !== undefined) data.countExamIds = dto.countExamIds;
      if (dto.rollPolicy !== undefined) data.rollPolicy = dto.rollPolicy;
      if (dto.copyTimetable !== undefined) data.copyTimetable = dto.copyTimetable;
      if (dto.carryLeave !== undefined) data.carryLeave = dto.carryLeave;
      if (dto.sectionMap !== undefined) {
        // Keys are closing sections, values are next-year sections or PASS_OUT — nothing else is stored.
        const entries = Object.entries(dto.sectionMap);
        if (entries.length > LIST_CEILING.STRUCTURE) throw new ApiError('VALIDATION', 'Too many classes in the map', 400, 'sectionMap');
        const sections = await tx.classSection.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId, academicYearId: { in: [plan.fromYearId, plan.toYearId] } },
          select: { id: true, academicYearId: true },
        });
        const closing = new Set(sections.filter((s) => s.academicYearId === plan.fromYearId).map((s) => s.id));
        const next = new Set(sections.filter((s) => s.academicYearId === plan.toYearId).map((s) => s.id));
        for (const [k, v] of entries) {
          if (!closing.has(k) || typeof v !== 'string' || (v !== PASS_OUT && !next.has(v))) {
            throw new ApiError('VALIDATION', 'The class map must send each closing class to a next-year class or PASS_OUT', 400, 'sectionMap');
          }
        }
        data.sectionMap = dto.sectionMap as Prisma.InputJsonValue;
      }
      return tx.sessionPlan.update({ where: { id: plan.id }, data, include: { fromYear: true, toYear: true } });
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
        have.add(`${f.gradeId}|${f.name.toLowerCase()}`);
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
      // `countExamIds` is one list for the whole plan, so it holds exam ids
      // from several classes: for THIS class only its own exams matter, and
      // "none of mine chosen" means all of them count.
      const mine = new Set(examsRaw.map((e) => e.id));
      const chosen = plan.countExamIds.filter((id) => mine.has(id));
      const examIds = chosen.length ? chosen : [...mine];
      const [marks, results, decisions] = await Promise.all([
        ids.length
          ? tx.attendance.groupBy({
              by: ['studentId', 'status'],
              where: { schoolId, studentId: { in: ids }, date: { gte: plan.fromYear.startDate, lte: plan.fromYear.endDate } },
              _count: { _all: true },
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
      const attendance = new Map<string, { present: number; total: number }>();
      for (const m of marks) {
        const a = attendance.get(m.studentId) ?? { present: 0, total: 0 };
        a.total += m._count._all;
        if (m.status !== 'ABSENT') a.present += m._count._all;
        attendance.set(m.studentId, a);
      }
      const resultsBy = groupBy(results);
      const decBy = new Map(decisions.map((d) => [d.studentId, d]));

      const rows: SessionStudentRow[] = students.map((s) => {
        const d = decBy.get(s.id);
        const a = attendance.get(s.id);
        const rp = resultsPct((resultsBy.get(s.id) ?? []).map((r) => ({ marks: r.marks, maxMarks: r.exam.maxMarks })));
        return {
          studentId: s.id,
          rollNo: s.rollNo,
          name: `${s.firstName} ${s.lastName}`.trim(),
          admissionNo: s.admissionNo,
          attendancePct: a && a.total > 0 ? Math.round((a.present / a.total) * 100) : null,
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
        exams: examsRaw.map((e) => ({ id: e.id, title: e.title, maxMarks: e.maxMarks, scheduledAt: e.scheduledAt, counted: examIds.includes(e.id) })),
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
    if (dto.when === 'ON_START_DATE') {
      const gate = await withTenant(schoolId, async (tx) => {
        const plan = await this.openPlan(tx, schoolId);
        if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
        if (plan.version !== dto.version) {
          throw new ApiError('PLAN_CHANGED', 'The plan changed since you opened this page. Reload and review again.', 409);
        }
        return plan;
      });
      const scheduledFor = startOfDayInZone(gate.toYear.startDate, await this.timezone(schoolId));
      await withTenant(schoolId, (tx) => tx.sessionPlan.update({ where: { id: gate.id }, data: { status: 'SCHEDULED', scheduledFor } }));
      await this.audit.record({ schoolId, actorUserId, action: 'session.schedule', entity: 'SessionPlan', entityId: gate.id, meta: { scheduledFor } });
      return { scheduled: true as const, scheduledFor: scheduledFor.toISOString() };
    }
    const planId = await withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      return plan.id;
    });
    const outcome = await this.applyPlan(schoolId, actorUserId, planId, dto.version);
    await this.afterStartSafely(schoolId, outcome);
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

  /**
   * The one transaction. Reused by the scheduled start (startDue). The plan is
   * CLAIMED first (one conditional update), so two clicks, or the cron and a
   * click, cannot both apply it: the second finds nothing open and stops.
   */
  private async applyPlan(schoolId: string, actorUserId: string, planId: string, expectedVersion?: number): Promise<StartOutcome> {
    const hasAlumniWing = (await this.features.getFeatures(schoolId)).has('ALUMNI');
    const now = new Date();
    const outcome = await withTenant(schoolId, async (tx) => {
      const plan = await tx.sessionPlan.findFirst({
        where: { id: planId, schoolId, status: { in: [...OPEN] } },
        include: { fromYear: true, toYear: true },
      });
      if (!plan) throw new ApiError('NO_PLAN', 'This plan has already been started or cancelled', 409);
      if (expectedVersion !== undefined && plan.version !== expectedVersion) {
        throw new ApiError('PLAN_CHANGED', 'The plan changed since you opened this page. Reload and review again.', 409);
      }
      const claimed = await tx.sessionPlan.updateMany({
        where: { id: plan.id, schoolId, status: { in: [...OPEN] } },
        data: { status: 'STARTED', startedAt: now, startedById: actorUserId },
      });
      if (claimed.count !== 1) throw new ApiError('NO_PLAN', 'This plan has already been started or cancelled', 409);

      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: { name: true, slug: true, domains: { take: 1, select: { hostname: true } } },
      });

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
        select: { id: true, userId: true, email: true, firstName: true, lastName: true, admissionNo: true, rollNo: true, classSectionId: true },
      });
      const decisions = await tx.sessionDecision.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, planId: plan.id } });
      const decBy = new Map(decisions.map((d) => [d.studentId, d]));
      const undecided = students.filter((s) => !decBy.has(s.id));
      if (undecided.length) {
        throw new ApiError('UNDECIDED_STUDENTS', `${undecided.length} students have no decision yet`, 400);
      }
      for (const s of students) {
        const d = decBy.get(s.id)!;
        if ((d.decision === 'PROMOTE' || d.decision === 'STAY') && (!d.toSectionId || !nextIds.has(d.toSectionId))) {
          throw new ApiError('BAD_TARGET', `${s.firstName} ${s.lastName} is promoted into a class that no longer exists. Decide again.`, 400, 'toSectionId');
        }
      }

      const o: StartOutcome = {
        moved: 0, alumni: 0, left: 0, slotsCopied: 0, slotsSkipped: 0, alumniDoor: false,
        alumniStudentIds: [], teacherUserIds: [], familyUserIds: [], leaverMails: [],
        sessionName: plan.toYear.name, schoolName: school?.name ?? '',
        schoolHost: school?.domains[0]?.hostname ?? `${school?.slug ?? ''}.${this.env.PLATFORM_HOST}`,
        carryLeave: plan.carryLeave, fromYearId: plan.fromYearId, toYearId: plan.toYearId,
      };

      const passingOut = students.filter((s) => decBy.get(s.id)!.decision === 'PASS_OUT');
      const leaving = students.filter((s) => decBy.get(s.id)!.decision === 'LEAVE');

      // Alumni first, while the passing-out children still read as the active
      // roster the Homecoming wing filters on — and ONLY those children.
      if (passingOut.length && hasAlumniWing) {
        await this.alumni.graduateBatchIn(
          tx, schoolId,
          { classSectionIds: Array.from(new Set(passingOut.map((s) => s.classSectionId!))), batchYear: plan.fromYear.endDate.getUTCFullYear() },
          passingOut.map((s) => s.id),
        );
        o.alumniDoor = true;
      }

      // Seats: one statement per destination class (or per chunk when renumbering).
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
        if (plan.rollPolicy === 'KEEP') {
          await tx.student.updateMany({ where: { schoolId, id: { in: group.map((s) => s.id) } }, data: { classSectionId: target } });
        } else {
          const rolls = assignRollNumbers(plan.rollPolicy as RollPolicy, group);
          for (const part of chunks(group)) {
            await tx.$executeRaw`
              UPDATE "Student" AS s
              SET "classSectionId" = v.section::uuid, "rollNo" = v.roll
              FROM (VALUES ${Prisma.join(part.map((s) => Prisma.sql`(${s.id}::uuid, ${target}::uuid, ${rolls.get(s.id) ?? null})`))}) AS v(id, section, roll)
              WHERE s.id = v.id AND s."schoolId" = ${schoolId}::uuid`;
          }
        }
        o.moved += group.length;
        for (const s of group) {
          if (s.userId) o.familyUserIds.push({ userId: s.userId, firstName: s.firstName, className: nextLabel.get(target) ?? '', stay: decBy.get(s.id)!.decision === 'STAY' });
        }
      }

      // Leavers: the same fields Track A's applyStudentLeave writes, one statement per group.
      const leftOn = plan.fromYear.endDate;
      const leaveBase = { isActive: false, leftOn, statusChangedAt: now, statusChangedById: actorUserId };
      if (passingOut.length) {
        await tx.student.updateMany({
          where: { schoolId, id: { in: passingOut.map((s) => s.id) }, status: 'ACTIVE' },
          data: { ...leaveBase, status: 'ALUMNI', alumniBatch: plan.fromYear.name, leftReason: null, leftNote: null },
        });
        o.alumni = passingOut.length;
        o.alumniStudentIds = passingOut.map((s) => s.id);
        for (const s of passingOut) if (s.email) o.leaverMails.push({ email: s.email, firstName: s.firstName, kind: 'ALUMNI' });
      }
      for (const status of ['TRANSFERRED', 'LEFT'] as const) {
        const group = leaving.filter((s) => (decBy.get(s.id)!.leaveStatus ?? 'LEFT') === status);
        if (!group.length) continue;
        await tx.student.updateMany({
          where: { schoolId, id: { in: group.map((s) => s.id) }, status: 'ACTIVE' },
          data: { ...leaveBase, status, alumniBatch: null, leftReason: null, leftNote: null },
        });
        const withText = group.filter((s) => decBy.get(s.id)!.leaveReason || decBy.get(s.id)!.note);
        for (const part of chunks(withText)) {
          await tx.$executeRaw`
            UPDATE "Student" AS s
            SET "leftReason" = v.reason, "leftNote" = v.note
            FROM (VALUES ${Prisma.join(part.map((s) => Prisma.sql`(${s.id}::uuid, ${decBy.get(s.id)!.leaveReason ?? null}, ${decBy.get(s.id)!.note ?? null})`))}) AS v(id, reason, note)
            WHERE s.id = v.id AND s."schoolId" = ${schoolId}::uuid`;
        }
        o.left += group.length;
        for (const s of group) if (s.email) o.leaverMails.push({ email: s.email, firstName: s.firstName, kind: status });
      }
      // Every leaver's login closes in the same transaction (D9).
      const closeUserIds = [...passingOut, ...leaving].map((s) => s.userId).filter((u): u is string => !!u);
      if (closeUserIds.length) {
        await tx.user.updateMany({ where: { schoolId, id: { in: closeUserIds } }, data: { isActive: false } });
        await tx.refreshToken.updateMany({ where: { schoolId, userId: { in: closeUserIds }, revokedAt: null }, data: { revokedAt: now } });
      }
      // The receipt on every decision: one statement per closing class.
      for (const c of closing) {
        const ids = students.filter((s) => s.classSectionId === c.id).map((s) => s.id);
        if (ids.length) {
          await tx.sessionDecision.updateMany({ where: { schoolId, planId: plan.id, studentId: { in: ids } }, data: { fromSectionId: c.id, appliedAt: now } });
        }
      }

      await tx.academicYear.update({ where: { id: plan.fromYearId }, data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id: plan.toYearId }, data: { isCurrent: true } });

      if (plan.copyTimetable) {
        // Visible from today if the session starts early, else from its first day.
        const effectiveFrom = new Date(Math.min(plan.toYear.startDate.getTime(), now.getTime()));
        const r = await this.copyTimetableIn(tx, schoolId, plan.fromYearId, plan.toYearId, closing, next, effectiveFrom);
        o.slotsCopied = r.copied;
        o.slotsSkipped = r.skipped;
        o.teacherUserIds = r.teacherUserIds;
      }

      await tx.registerChangeRequest.updateMany({
        where: { schoolId, classSectionId: { in: closing.map((c) => c.id) }, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedAt: now, reviewedByUserId: actorUserId },
      });
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
   * The timetable follows the CLASSROOM: 5 B's periods become next year's
   * 5 B. Only slots of ACTIVE teachers; a period the class or the teacher
   * already has in the new year is skipped, never doubled — so running this
   * before Start (the office adjusting the copy) and again at Start is safe.
   */
  private async copyTimetableIn(
    tx: TenantTx,
    schoolId: string,
    fromYearId: string,
    toYearId: string,
    closing: { id: string; gradeId: string; name: string }[],
    next: { id: string; gradeId: string; name: string }[],
    effectiveFrom: Date,
  ): Promise<{ copied: number; skipped: number; teacherUserIds: string[] }> {
    const key = (s: { gradeId: string; name: string }) => `${s.gradeId}|${s.name.toLowerCase()}`;
    const nextByKey = new Map(next.map((n) => [key(n), n.id]));
    const closingById = new Map(closing.map((c) => [c.id, c]));
    const [slots, taken] = await Promise.all([
      tx.timetableSlot.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, academicYearId: fromYearId, effectiveTo: null },
        select: { classSectionId: true, dayOfWeek: true, periodId: true, subjectId: true, teacherId: true, teacher: { select: { status: true, userId: true } } },
      }),
      tx.timetableSlot.findMany({
        take: LIST_CEILING.ROSTER,
        where: { schoolId, academicYearId: toYearId, effectiveTo: null },
        select: { classSectionId: true, dayOfWeek: true, periodId: true, teacherId: true },
      }),
    ]);
    const classTaken = new Set(taken.map((t) => `${t.classSectionId}|${t.dayOfWeek}|${t.periodId}`));
    const teacherTaken = new Set(taken.map((t) => `${t.teacherId}|${t.dayOfWeek}|${t.periodId}`));
    const rows: Prisma.TimetableSlotCreateManyInput[] = [];
    const teacherUserIds: string[] = [];
    let skipped = 0;
    for (const sl of slots) {
      const from = closingById.get(sl.classSectionId);
      const target = from ? nextByKey.get(key(from)) : undefined;
      const ck = target ? `${target}|${sl.dayOfWeek}|${sl.periodId}` : '';
      const tk = `${sl.teacherId}|${sl.dayOfWeek}|${sl.periodId}`;
      if (!target || sl.teacher.status !== 'ACTIVE' || classTaken.has(ck) || teacherTaken.has(tk)) {
        skipped++;
        continue;
      }
      classTaken.add(ck);
      teacherTaken.add(tk);
      rows.push({ schoolId, classSectionId: target, dayOfWeek: sl.dayOfWeek, periodId: sl.periodId, subjectId: sl.subjectId, teacherId: sl.teacherId, academicYearId: toYearId, effectiveFrom });
      if (sl.teacher.userId) teacherUserIds.push(sl.teacher.userId);
    }
    let copied = 0;
    for (const part of chunks(rows)) {
      const r = await tx.timetableSlot.createMany({ data: part, skipDuplicates: true });
      copied += r.count;
    }
    return { copied, skipped, teacherUserIds };
  }

  /**
   * Step 5's "preview and adjust": copy the timetable into the next year NOW,
   * effective from the session's first day, so the office can move periods
   * around in the ordinary timetable editor before Start. Start copies again
   * and skips what is already there.
   */
  async copyTimetableNow(schoolId: string, actorUserId: string) {
    const r = await withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const sections = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: { in: [plan.fromYearId, plan.toYearId] } },
        select: { id: true, gradeId: true, name: true, academicYearId: true },
      });
      const closing = sections.filter((s) => s.academicYearId === plan.fromYearId);
      const next = sections.filter((s) => s.academicYearId === plan.toYearId);
      const out = await this.copyTimetableIn(tx, schoolId, plan.fromYearId, plan.toYearId, closing, next, plan.toYear.startDate);
      return { copied: out.copied, skipped: out.skipped, nextYearClasses: next.length };
    });
    await this.audit.record({ schoolId, actorUserId, action: 'session.timetable.copy', entity: 'SessionPlan', entityId: schoolId, meta: r });
    return r;
  }

  /**
   * The master button on the Decide step: every child in a closing class who
   * has no decision yet gets the class map's default — promoted into the
   * mapped class, or passing out from the top grade. One statement per class;
   * existing decisions are never touched (skipDuplicates on the unique key).
   */
  async applyDefaults(schoolId: string, actorUserId: string) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.editablePlan(tx, schoolId);
      const map = (plan.sectionMap ?? {}) as SectionMap;
      const sections = await tx.classSection.findMany({
        take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: { in: [plan.fromYearId, plan.toYearId] } },
        select: { id: true, name: true, academicYearId: true, grade: { select: { name: true } } },
      });
      const closing = sections.filter((s) => s.academicYearId === plan.fromYearId);
      const nextIds = new Set(sections.filter((s) => s.academicYearId === plan.toYearId).map((s) => s.id));
      const [students, decided] = await Promise.all([
        tx.student.findMany({
          take: LIST_CEILING.ROSTER,
          where: activeStudentsWhere(schoolId, { classSectionId: { in: closing.map((c) => c.id) } }),
          select: { id: true, classSectionId: true },
        }),
        tx.sessionDecision.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, planId: plan.id }, select: { studentId: true } }),
      ]);
      const already = new Set(decided.map((d) => d.studentId));
      const unmapped: string[] = [];
      let decidedNow = 0;
      for (const c of closing) {
        const target = map[c.id];
        const pending = students.filter((s) => s.classSectionId === c.id && !already.has(s.id));
        if (!pending.length) continue;
        if (!target || (target !== PASS_OUT && !nextIds.has(target))) {
          unmapped.push(`${c.grade.name} ${c.name}`);
          continue;
        }
        const r = await tx.sessionDecision.createMany({
          data: pending.map((s) => ({
            schoolId, planId: plan.id, studentId: s.id,
            decision: target === PASS_OUT ? ('PASS_OUT' as const) : ('PROMOTE' as const),
            toSectionId: target === PASS_OUT ? null : target,
            decidedById: actorUserId,
          })),
          skipDuplicates: true,
        });
        decidedNow += r.count;
      }
      const updated = await tx.sessionPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } }, select: { version: true } });
      return { decided: decidedNow, alreadyDecided: already.size, unmapped, version: updated.version };
    });
  }

  /** The year end has committed; nothing after it may turn the admin's screen red. */
  private async afterStartSafely(schoolId: string, o: StartOutcome): Promise<void> {
    try {
      await this.afterStart(schoolId, o);
    } catch (e) {
      this.logger.error(`after-start notifications for ${schoolId} failed: ${(e as Error).message}`);
    }
  }

  /**
   * After commit: the bell for every moved family and every teacher with a
   * copied class (one statement), then the emails in the background — "your
   * child is in 6 A" to families, and the alumni door (a claim link, the
   * credential itself) to every new alumnus with an address.
   */
  private async afterStart(schoolId: string, o: StartOutcome): Promise<void> {
    const session = o.sessionName;
    assertNotificationKind('SESSION');
    assertNotificationOutboxKind('SESSION_STARTED');
    const rows: Prisma.NotificationCreateManyInput[] = [];
    const seenFamily = new Set<string>();
    const pushes: Prisma.NotificationOutboxCreateManyInput[] = [];
    for (const f of o.familyUserIds) {
      if (seenFamily.has(f.userId)) continue;
      seenFamily.add(f.userId);
      // A child who stays in grade is told so plainly — "is in 5 B again" is
      // the sentence a parent reads twice; "continues in" is the one they need.
      const title = f.stay ? `${f.firstName} continues in ${f.className} for ${session}` : `${f.firstName} is in ${f.className} for ${session}`;
      const body = 'The new class, timetable and diary are ready.';
      rows.push({ schoolId, userId: f.userId, kind: 'SESSION', title, body, linkType: 'home', linkId: null });
      pushes.push({ schoolId, kind: 'SESSION_STARTED', targetUserId: f.userId, payload: { schoolName: o.schoolName, title, body } as unknown as Prisma.InputJsonValue });
    }
    for (const userId of new Set(o.teacherUserIds)) {
      rows.push({
        schoolId, userId, kind: 'SESSION',
        title: `Session ${session} has started`,
        body: 'Your classes and timetable for the new session are ready.',
        linkType: 'today', linkId: null,
      });
    }
    if (rows.length) {
      await withTenant(schoolId, async (tx) => {
        for (const part of chunks(rows, 1000)) await tx.notification.createMany({ data: part });
        // Push rides the guaranteed outbox (drained by cron), one row per family.
        for (const part of chunks(pushes, 1000)) await tx.notificationOutbox.createMany({ data: part });
      });
    }

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
        // Leavers: their login is closed, so the letter is the only channel.
        // A new alumnus with the Homecoming wing gets the claim link instead
        // (below); everyone else gets the plain passed-out / left letter.
        for (const l of o.leaverMails) {
          if (l.kind === 'ALUMNI') {
            if (!o.alumniDoor) await this.mail.sendPassedOut(l.email, o.schoolName, l.firstName, o.sessionName, schoolId);
          } else {
            await this.mail.sendLeft(l.email, o.schoolName, l.firstName, l.kind, o.sessionName, schoolId);
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
              const claimUrl = `https://${o.schoolHost}/alumni#claim=${token}`;
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
          include: { student: { select: { firstName: true, lastName: true, admissionNo: true, email: true } } },
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
        email: r.student.email ?? null,
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
        await this.afterStartSafely(p.schoolId, outcome);
        started.push(p.id);
      } catch (e) {
        this.logger.error(`scheduled session start for plan ${p.id} failed: ${(e as Error).message}`);
      }
    }
    return { started };
  }
}
