import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { isP2002 } from '../../../common/errors/prisma-errors';
import {
  buildSlots,
  decideSession,
  isRequestable,
  isoWeekday,
  MAX_COUNTER_ROUNDS,
  type SessionActor,
  type SlotView,
} from './homecoming-rules';
import type { DecideSessionDto, RequestSessionDto, SlotsQueryDto } from './alumni.dto';

/** A fortnight. Longer windows make an enormous grid nobody reads, and they make
 *  the holiday/exam queries scan a range the indexes are not shaped for. */
const MAX_SLOT_DAYS = 14;

export interface SlotsResult {
  classSectionId: string;
  headcount: number;
  slots: SlotView[];
  truncatedTo: number;
}

/** `YYYY-MM-DD` in UTC, so a machine running in IST does not shift the day. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${fromYmd}T00:00:00Z`);
  const end = new Date(`${toYmd}T00:00:00Z`);
  while (cur <= end && out.length < MAX_SLOT_DAYS) {
    out.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

@Injectable()
export class GuestSessionsService {
  /**
   * Which periods exist, and which may be asked for.
   *
   * `audience` is a parameter rather than a filter applied on the way out. An
   * alumnus gets real periods, real times and real availability — and never a
   * subject or a teacher's name, because a full timetable tells an outsider
   * exactly where three hundred children are at every minute of the week. That
   * is a fact about a building, not a preference about privacy.
   */
  async slots(
    schoolId: string,
    q: SlotsQueryDto,
    audience: 'ALUMNUS' | 'OFFICE',
  ): Promise<SlotsResult> {
    return withTenant(schoolId, (tx) => this.slotsIn(tx, schoolId, q, audience));
  }

  /**
   * The same computation, against a transaction the CALLER owns.
   *
   * `request` and `decide` both need to re-check availability immediately before
   * they write. Calling the public `slots` from inside their own `withTenant`
   * would open a second transaction on a second connection — which is a pool
   * risk under load, and worse, makes the check and the write non-atomic: the
   * period could be taken by somebody else in between. Sharing the caller's `tx`
   * keeps read and write in one transaction, so the row a decision was made on
   * is the row it is written against.
   */
  private async slotsIn(
    tx: TenantTx,
    schoolId: string,
    q: SlotsQueryDto,
    audience: 'ALUMNUS' | 'OFFICE',
  ): Promise<SlotsResult> {
    const dates = eachDay(q.from.slice(0, 10), q.to.slice(0, 10));
    if (dates.length === 0) {
      throw new ApiError('BAD_DATE_RANGE', 'That date range is empty or backwards.', 400);
    }
    const first = new Date(`${dates[0]}T00:00:00Z`);
    const last = new Date(`${dates[dates.length - 1]}T23:59:59Z`);

    {
      const section = await tx.classSection.findFirst({
        where: { id: q.classSectionId, schoolId },
        select: { id: true },
      });
      if (!section) throw new NotFoundException('That class is not in this school.');

      const [periods, slots, holidays, exams, sessions, headcount] = await Promise.all([
        tx.period.findMany({
          where: { schoolId, kind: 'CLASS' },
          orderBy: { order: 'asc' },
          select: { id: true, order: true, label: true, startTime: true, endTime: true },
        }),
        tx.timetableSlot.findMany({
          where: {
            schoolId,
            classSectionId: q.classSectionId,
            // Only slots in force during the window. A timetable that changed
            // mid-term must not offer periods from the old one.
            effectiveFrom: { lte: last },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: first } }],
          },
          select: {
            dayOfWeek: true,
            periodId: true,
            subjectId: true,
            teacherId: true,
            subject: { select: { name: true } },
            teacher: { select: { firstName: true, lastName: true } },
          },
        }),
        tx.holiday.findMany({
          where: {
            schoolId,
            startDate: { lte: last },
            OR: [{ endDate: null }, { endDate: { gte: first } }],
          },
          select: { startDate: true, endDate: true },
        }),
        tx.exam.findMany({
          where: {
            schoolId,
            classSectionId: q.classSectionId,
            scheduledAt: { gte: first, lte: last },
          },
          select: { scheduledAt: true },
        }),
        tx.guestSession.findMany({
          where: {
            schoolId,
            classSectionId: q.classSectionId,
            status: { in: ['REQUESTED', 'COUNTERED', 'SCHEDULED'] },
          },
          select: {
            status: true,
            requestedDate: true,
            requestedPeriodId: true,
            counterDate: true,
            counterPeriodId: true,
            scheduledDate: true,
            scheduledPeriodId: true,
          },
        }),
        tx.student.count({ where: { schoolId, isActive: true, classSectionId: q.classSectionId } }),
      ]);

      const holidaySet = new Set<string>();
      for (const h of holidays) {
        for (const d of eachDay(ymd(h.startDate), ymd(h.endDate ?? h.startDate))) holidaySet.add(d);
      }

      const taken = new Map<string, 'HELD' | 'BOOKED'>();
      for (const s of sessions) {
        const mark = (date: Date | null, periodId: string | null, as: 'HELD' | 'BOOKED') => {
          if (!date || !periodId) return;
          taken.set(`${ymd(date)}|${periodId}`, as);
        };
        // A live counter holds BOTH slots. Accepting a suggested time and
        // finding it gone in the meantime is the most annoying outcome
        // available, so neither is offered while the host is deciding.
        mark(s.requestedDate, s.requestedPeriodId, s.status === 'SCHEDULED' ? 'BOOKED' : 'HELD');
        mark(s.counterDate, s.counterPeriodId, 'HELD');
        mark(s.scheduledDate, s.scheduledPeriodId, 'BOOKED');
      }

      return {
        classSectionId: q.classSectionId,
        headcount,
        truncatedTo: MAX_SLOT_DAYS,
        slots: buildSlots(
          {
            dates,
            periods,
            timetable: slots.map((s) => ({
              weekday: s.dayOfWeek,
              periodId: s.periodId,
              subjectId: s.subjectId,
              subjectName: s.subject?.name ?? null,
              teacherId: s.teacherId,
              teacherName: s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}`.trim() : null,
            })),
            holidays: holidaySet,
            examDates: new Set(exams.map((e) => ymd(e.scheduledAt))),
            taken,
          },
          audience,
        ),
      };
    }
  }

  /** Only a `trustedForStudents` alumnus can ask. Being a verified alumnus gets
   *  you the directory; it does not get you a room full of fourteen-year-olds. */
  async request(schoolId: string, dto: RequestSessionDto) {
    return withTenant(schoolId, async (tx) => {
      const alum = await tx.alumni.findFirst({ where: { id: dto.alumniId, schoolId } });
      if (!alum) throw new NotFoundException('Alumni record not found');
      if (alum.status !== 'VERIFIED' || !alum.trustedForStudents) {
        throw new ApiError(
          'NOT_TRUSTED_FOR_STUDENTS',
          'Only an alumnus the school has cleared to work with students can request a session.',
          403,
        );
      }

      const date = dto.date.slice(0, 10);
      const view = await this.slotsIn(
        tx,
        schoolId,
        { classSectionId: dto.classSectionId, from: date, to: date },
        'ALUMNUS',
      );
      const slot = view.slots.find((s) => s.periodId === dto.periodId);
      if (!slot) throw new NotFoundException('That period is not on this school’s timetable.');
      if (!isRequestable(slot.state)) {
        throw new ApiError(
          'SLOT_NOT_AVAILABLE',
          slot.state === 'CLOSED'
            ? 'That week is closed — there is an exam or a holiday.'
            : 'Somebody has already asked for that period.',
          409,
        );
      }

      try {
        return await tx.guestSession.create({
          data: {
            schoolId,
            alumniId: dto.alumniId,
            title: dto.title.trim(),
            summary: dto.summary?.trim() || null,
            mode: dto.mode ?? 'IN_PERSON',
            classSectionId: dto.classSectionId,
            // Frozen for the same reason as GiftPledge.headcountAtPledge.
            headcountAtBooking: view.headcount,
            requestedDate: new Date(`${date}T00:00:00Z`),
            requestedPeriodId: dto.periodId,
            status: 'REQUESTED',
          },
        });
      } catch (e) {
        // GuestSession_live_slot_key. The check above and this write share one
        // transaction, which is atomicity and not mutual exclusion — under READ
        // COMMITTED a simultaneous requester reads the same FREE snapshot. The
        // partial unique index is what actually stops the double booking; this
        // turns its violation into the same 409 the check would have given.
        if (isP2002(e)) {
          throw new ApiError(
            'SLOT_NOT_AVAILABLE',
            'Somebody asked for that period a moment before you did.',
            409,
          );
        }
        throw e;
      }
    });
  }

  async list(schoolId: string, status?: string) {
    return withTenant(schoolId, (tx) =>
      tx.guestSession.findMany({
        where: { schoolId, ...(status ? { status: status as never } : {}) },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        include: {
          alumni: {
            select: {
              firstName: true, lastName: true, batchYear: true,
              profession: true, employer: true, trustedForStudents: true,
            },
          },
        },
      }),
    );
  }

  /**
   * The conflict panel: five phone calls collapsed into one screen. Everything
   * here already sits in the database — the timetable, the room, the exam
   * calendar, the class register. None of it needed a new source of truth.
   */
  async conflicts(schoolId: string, sessionId: string) {
    return withTenant(schoolId, async (tx) => {
      const s = await tx.guestSession.findFirst({ where: { id: sessionId, schoolId } });
      if (!s) throw new NotFoundException('Session not found');
      const date = ymd(s.requestedDate);
      const wd = isoWeekday(date);

      const [lesson, examsNearby, sessionsThisTerm, siblingSections] = await Promise.all([
        tx.timetableSlot.findFirst({
          where: {
            schoolId, classSectionId: s.classSectionId, dayOfWeek: wd, periodId: s.requestedPeriodId,
          },
          select: {
            subjectId: true, teacherId: true,
            subject: { select: { name: true } },
            teacher: { select: { firstName: true, lastName: true } },
          },
        }),
        // A guest lecture two days before a unit test is a judgement call, not a
        // block — so it is surfaced in words and the office decides.
        tx.exam.findMany({
          where: {
            schoolId,
            classSectionId: s.classSectionId,
            scheduledAt: {
              gte: new Date(`${date}T00:00:00Z`),
              lte: new Date(new Date(`${date}T00:00:00Z`).getTime() + 7 * 864e5),
            },
          },
          select: { title: true, scheduledAt: true },
          orderBy: { scheduledAt: 'asc' },
          take: 3,
        }),
        tx.guestSession.count({
          where: { schoolId, classSectionId: s.classSectionId, status: { in: ['SCHEDULED', 'DELIVERED'] } },
        }),
        // "9-A has had one, 9-B has had none" — a fact in front of whoever
        // decides, never a hard block.
        tx.classSection.findMany({
          where: { schoolId, id: { not: s.classSectionId } },
          select: { id: true, name: true, grade: { select: { name: true } } },
          take: 40,
        }),
      ]);

      // One grouped query, not one count per section. The first cut fired a
      // COUNT for every sibling class — forty round trips inside an open
      // transaction, to render a hint. A school with forty sections is the
      // normal case here, not the pathological one.
      const grouped = await tx.guestSession.groupBy({
        by: ['classSectionId'],
        where: {
          schoolId,
          classSectionId: { in: siblingSections.map((x) => x.id) },
          status: { in: ['SCHEDULED', 'DELIVERED'] },
        },
        _count: { _all: true },
      });
      const bySection = new Map(grouped.map((g) => [g.classSectionId, g._count._all]));
      const siblingCounts = siblingSections.map((sec) => ({
        label: sec.grade ? `${sec.grade.name} – ${sec.name}` : sec.name,
        // groupBy returns no row for a section with zero sessions, and zero is
        // the answer this hint most wants to surface — "9-B has had none".
        sessions: bySection.get(sec.id) ?? 0,
      }));

      return {
        date,
        displaced: lesson
          ? {
              subjectId: lesson.subjectId,
              subjectName: lesson.subject?.name ?? null,
              teacherId: lesson.teacherId,
              teacherName: lesson.teacher
                ? `${lesson.teacher.firstName} ${lesson.teacher.lastName}`.trim()
                : null,
            }
          : null,
        examsWithinAWeek: examsNearby.map((e) => ({ title: e.title, on: ymd(e.scheduledAt) })),
        sessionsThisClass: sessionsThisTerm,
        siblingSections: siblingCounts.sort((a, b) => a.sessions - b.sessions).slice(0, 6),
      };
    });
  }

  /**
   * Whoever moves last is the one who schedules it. The school accepting books
   * it; the school countering and the host accepting books it, with no third
   * approval — the school proposing a time IS the school approving it.
   */
  async decide(
    schoolId: string,
    sessionId: string,
    userId: string | null,
    actor: SessionActor,
    dto: DecideSessionDto,
  ) {
    return withTenant(schoolId, async (tx) => {
      const s = await tx.guestSession.findFirst({ where: { id: sessionId, schoolId } });
      if (!s) throw new NotFoundException('Session not found');

      // The teacher named on THIS request wins; otherwise whatever is already
      // stored. Nothing can blank it back to null on the way to SCHEDULED.
      const teacherId = dto.accompanyingTeacherId ?? s.accompanyingTeacherId;
      // Both of these are client-supplied foreign keys, and neither the FK
      // constraint nor RLS will catch one that belongs to another school:
      // Postgres referential-integrity checks bypass row-level security by
      // design, so a constraint is satisfied by a row the caller cannot see.
      // The `where` clauses below are what actually scope them.
      if (dto.accompanyingTeacherId) {
        const t = await tx.teacher.findFirst({
          where: { id: dto.accompanyingTeacherId, schoolId },
          select: { id: true },
        });
        if (!t) throw new NotFoundException('That teacher is not on this school’s staff.');
      }
      if (dto.roomId) {
        const r = await tx.room.findFirst({ where: { id: dto.roomId, schoolId }, select: { id: true } });
        if (!r) throw new NotFoundException('That room is not in this school.');
      }

      const decision = decideSession(s.status, dto.action, actor, {
        accompanyingTeacherId: teacherId,
        counterRound: s.counterRound,
      });
      if (!decision.ok) {
        // Spelled out rather than built with a template literal. `SESSION_` plus
        // an interpolated reason typechecks as `SESSION_undefined` too, and an
        // ErrorCode a client cannot switch on is worse than no code at all.
        const REFUSALS = {
          NEEDS_ACCOMPANYING_TEACHER: {
            code: 'SESSION_NEEDS_ACCOMPANYING_TEACHER',
            message: 'A session cannot be scheduled until somebody is named to be in the room.',
            http: 400,
          },
          COUNTER_LIMIT_REACHED: {
            code: 'SESSION_COUNTER_LIMIT_REACHED',
            message: `The school has already suggested ${MAX_COUNTER_ROUNDS} alternative. Anything further is a phone call.`,
            http: 409,
          },
          WRONG_ACTOR: {
            code: 'SESSION_WRONG_ACTOR',
            message: 'That is not this side’s move to make.',
            http: 403,
          },
          ILLEGAL_TRANSITION: {
            code: 'SESSION_ILLEGAL_TRANSITION',
            message: `A ${s.status.toLowerCase()} session cannot be ${dto.action.toLowerCase()}ed.`,
            http: 409,
          },
        } as const;
        const refusal = decision.reason ? REFUSALS[decision.reason] : undefined;
        // decideSession always sets a reason when ok is false; this is the
        // belt-and-braces branch, not a real path.
        if (!refusal) throw new ApiError('SESSION_ILLEGAL_TRANSITION', 'That is not allowed.', 409);
        throw new ApiError(refusal.code, refusal.message, refusal.http);
      }

      if (dto.action === 'DECLINE' && !dto.reason?.trim()) {
        throw new ApiError('REASON_REQUIRED', 'A declined request owes the alumnus a reason.', 400);
      }

      const data: Record<string, unknown> = {
        status: decision.next,
        accompanyingTeacherId: teacherId,
        decidedByUserId: userId,
        decidedAt: new Date(),
      };

      if (dto.action === 'COUNTER') {
        if (!dto.counterDate || !dto.counterPeriodId) {
          throw new ApiError('COUNTER_SLOT_REQUIRED', 'Suggest a date and a period.', 400);
        }
        const cd = dto.counterDate.slice(0, 10);
        const view = await this.slotsIn(
          tx,
          schoolId,
          { classSectionId: s.classSectionId, from: cd, to: cd },
          'OFFICE',
        );
        const slot = view.slots.find((x) => x.periodId === dto.counterPeriodId);
        if (!slot || !isRequestable(slot.state)) {
          throw new ApiError('SLOT_NOT_AVAILABLE', 'That period is not free either.', 409);
        }
        data.counterDate = new Date(`${cd}T00:00:00Z`);
        data.counterPeriodId = dto.counterPeriodId;
        data.counterNote = dto.counterNote?.trim() || null;
        data.counterRound = s.counterRound + 1;
      }

      if (decision.next === 'SCHEDULED') {
        // Whichever slot was on the table when the last person said yes.
        const fromCounter = s.status === 'COUNTERED';
        data.scheduledDate = fromCounter ? s.counterDate : s.requestedDate;
        data.scheduledPeriodId = fromCounter ? s.counterPeriodId : s.requestedPeriodId;
        data.roomId = dto.roomId ?? s.roomId;

        // Recorded AT DECISION TIME, never inferred later — six months on,
        // "which period did 9-A lose" is a syllabus question somebody asks.
        const wd = isoWeekday(ymd(data.scheduledDate as Date));
        const lesson = await tx.timetableSlot.findFirst({
          where: {
            schoolId,
            classSectionId: s.classSectionId,
            dayOfWeek: wd,
            periodId: data.scheduledPeriodId as string,
          },
          select: { subjectId: true, teacherId: true },
        });
        data.displacedSubjectId = lesson?.subjectId ?? null;
        data.displacedTeacherId = lesson?.teacherId ?? null;
      }

      if (dto.action === 'DECLINE') data.declineReason = dto.reason!.trim();
      if (dto.action === 'DELIVER') {
        data.deliveredAt = new Date();
        data.attendedCount = dto.attendedCount ?? null;
      }

      return tx.guestSession.update({ where: { id: sessionId }, data });
    });
  }
}
