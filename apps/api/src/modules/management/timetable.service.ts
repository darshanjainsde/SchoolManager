import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type { TimetableSlot } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, p2002Target } from '../../common/errors/prisma-errors';
import { istTodayISO, resolveAsOfDate, shortDayDate, startOfIstDay } from './internal/timetable-date';
import { applySplice, planSplice } from './internal/timetable-splice';
import type { AssignSlotDto, AvailabilityQueryDto, SubjectTeacherApplyDto, SubjectTeacherPreviewDto } from './management.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

export type { TimetableSlot };

/** Versions live on `d`: started on or before it, not yet ended. */
const liveOn = (d: Date) => ({ effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: d } }] });
/** An IST midnight → 'YYYY-MM-DD'. */
const istDay = (d: Date) => istTodayISO(d);

const SLOT_INCLUDE = {
  period: true,
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  // `grade` is required so callers can compose "7-B" the way TeacherDayService
  // does — a section's bare `name` ("B") is ambiguous across grades, and the
  // web timetable grid must show the same class name the Today screen does.
  classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
} as const;

@Injectable()
export class TimetableService {
  /**
   * The slot versions ACTIVE on `date` (default: today) for `classSectionId`
   * — i.e. `effectiveFrom <= date AND (effectiveTo IS NULL OR effectiveTo > date)`.
   * Reading a past `date` returns whatever version was active back then, even
   * if it has since been superseded — that's what makes past weeks immutable.
   */
  async listForClass(schoolId: string, classSectionId: string, date?: string): Promise<TimetableSlot[]> {
    const asOf = resolveAsOfDate(date, new Date());
    return withTenant(schoolId, (tx) =>
      tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY,
        where: {
          schoolId,
          classSectionId,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
        include: SLOT_INCLUDE,
      }),
    );
  }

  /**
   * Put a subject and a teacher in one period, over a window of time.
   *
   * The period is a run of dated versions (see internal/timetable-splice.ts):
   * the change is spliced in over [from, until), so every week before `from`
   * reads exactly as it was taught. `from` defaults to today and is never
   * earlier — a past week cannot be edited, by the editor or by this API.
   * `until` absent = every coming week; a date = that week only, after which
   * the earlier value comes back on its own.
   *
   * A teacher cannot be in two classes at once: any version of theirs in
   * another class, in this weekday and period, that overlaps the window is a
   * TEACHER_CONFLICT naming that class.
   */
  async assign(schoolId: string, dto: AssignSlotDto) {
    const win = this.window(dto.from, dto.until);
    return this.writeCells(schoolId, dto, [{ dayOfWeek: dto.dayOfWeek, periodId: dto.periodId }], win, { strict: true }).then((r) => r.slots[0]);
  }

  /**
   * "Also give Rishika the other English periods of V-B": every period of the
   * subject in this class, live on `from`, held by someone else — plus the
   * clicked period — each checked for the teacher's clashes over the window
   * and for the dated things a swap disturbs. Reads only.
   */
  async previewSubjectTeacher(schoolId: string, dto: SubjectTeacherPreviewDto) {
    const win = this.window(dto.from, dto.until);
    return withTenant(schoolId, async (tx) => {
      const [teacher, subject] = await Promise.all([
        tx.teacher.findFirst({ where: { schoolId, id: dto.teacherId }, select: { id: true, firstName: true, lastName: true, isActive: true } }),
        tx.subject.findFirst({ where: { schoolId, id: dto.subjectId }, select: { id: true, name: true } }),
      ]);
      if (!teacher) throw new BadRequestException('teacherId not found in this school');
      if (!subject) throw new BadRequestException('subjectId not found in this school');

      const live = await tx.timetableSlot.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, classSectionId: dto.classSectionId, academicYearId: dto.academicYearId, ...liveOn(win.from) },
        select: { dayOfWeek: true, periodId: true, subjectId: true, teacherId: true, period: { select: { label: true, order: true } }, teacher: { select: { firstName: true, lastName: true } } },
      });
      const key = (c: { dayOfWeek: number; periodId: string }) => `${c.dayOfWeek}:${c.periodId}`;
      const bySlot = new Map(live.map((l) => [key(l), l]));
      const ofSubject = live.filter((l) => l.subjectId === dto.subjectId);
      const rows = ofSubject.filter((l) => l.teacherId !== dto.teacherId).map((l) => ({ dayOfWeek: l.dayOfWeek, periodId: l.periodId }));
      let clicked: { dayOfWeek: number; periodId: string } | null = null;
      if (dto.cell) {
        clicked = { dayOfWeek: dto.cell.dayOfWeek, periodId: dto.cell.periodId };
        const already = bySlot.get(key(clicked));
        const isNoop = already && already.subjectId === dto.subjectId && already.teacherId === dto.teacherId;
        if (!isNoop && !rows.some((r) => key(r) === key(clicked!))) rows.unshift(clicked);
      }
      const periods = await tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(rows.map((r) => r.periodId))] } }, select: { id: true, label: true, order: true } });
      const periodOf = new Map(periods.map((p) => [p.id, p]));

      const out = [];
      for (const r of rows) {
        const cur = bySlot.get(key(r));
        const clash = await this.clashFor(tx, schoolId, dto.teacherId, dto.academicYearId, dto.classSectionId, r, win);
        out.push({
          dayOfWeek: r.dayOfWeek,
          periodId: r.periodId,
          periodLabel: periodOf.get(r.periodId)?.label ?? '',
          periodOrder: periodOf.get(r.periodId)?.order ?? 0,
          clicked: !!clicked && key(r) === key(clicked),
          current: cur ? { subjectId: cur.subjectId, teacherId: cur.teacherId, teacherName: `${cur.teacher.firstName} ${cur.teacher.lastName}`.trim() } : null,
          clash,
          warnings: await this.warningsFor(tx, schoolId, dto.teacherId, dto.classSectionId, r, win, cur ? `${cur.teacher.firstName} ${cur.teacher.lastName}`.trim() : null),
        });
      }
      out.sort((x, y) => Number(y.clicked) - Number(x.clicked) || x.dayOfWeek - y.dayOfWeek || x.periodOrder - y.periodOrder);

      const load = await tx.timetableSlot.count({ where: { schoolId, teacherId: dto.teacherId, academicYearId: dto.academicYearId, ...liveOn(win.from) } });
      return {
        teacher: { id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`.trim(), active: teacher.isActive },
        subject,
        from: istDay(win.from),
        until: win.until ? istDay(win.until) : null,
        rows: out,
        alreadyTheirs: ofSubject.length - ofSubject.filter((l) => l.teacherId !== dto.teacherId).length,
        load: { now: load },
      };
    });
  }

  /**
   * Apply the periods the office ticked. All of them land or none do, EXCEPT
   * a period that has picked up a clash since the preview (someone booked the
   * teacher in between): that one is skipped and reported, never forced.
   */
  async applySubjectTeacher(schoolId: string, dto: SubjectTeacherApplyDto) {
    const win = this.window(dto.from, dto.until);
    const unique = [...new Map(dto.cells.map((c) => [`${c.dayOfWeek}:${c.periodId}`, c])).values()];
    const r = await this.writeCells(schoolId, dto, unique, win, { strict: false });
    return { changed: r.slots.length, skipped: r.skipped, from: istDay(win.from), until: win.until ? istDay(win.until) : null };
  }

  /** The shared write: validate the references once, then splice each cell in one transaction. */
  private async writeCells(
    schoolId: string,
    ref: { classSectionId: string; subjectId: string; teacherId: string; academicYearId: string },
    cells: { dayOfWeek: number; periodId: string }[],
    win: { from: Date; until: Date | null },
    opts: { strict: boolean },
  ) {
    try {
      return await withTenant(schoolId, async (tx) => {
        const [cs, subject, teacher, year, periods] = await Promise.all([
          tx.classSection.findUnique({ where: { id: ref.classSectionId } }),
          tx.subject.findUnique({ where: { id: ref.subjectId } }),
          tx.teacher.findUnique({ where: { id: ref.teacherId } }),
          tx.academicYear.findUnique({ where: { id: ref.academicYearId } }),
          tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: cells.map((c) => c.periodId) } }, select: { id: true } }),
        ]);
        if (!cs) throw new BadRequestException('classSectionId not found in this school');
        if (!subject) throw new BadRequestException('subjectId not found in this school');
        if (!teacher) throw new BadRequestException('teacherId not found in this school');
        if (!year) throw new BadRequestException('academicYearId not found in this school');
        if (periods.length !== new Set(cells.map((c) => c.periodId)).size) throw new BadRequestException('periodId not found in this school');
        if (!teacher.isActive) throw new ApiError('VALIDATION', `${teacher.firstName} ${teacher.lastName} has left the school and cannot be given periods.`, 400, 'teacherId');

        // Two offices moving the same teacher at once: one waits for the other.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}), hashtext(${`timetable-teacher:${ref.teacherId}`}))::text`;

        const slots = [];
        const skipped: { dayOfWeek: number; periodId: string; reason: string }[] = [];
        for (const c of cells) {
          const clash = await this.clashFor(tx, schoolId, ref.teacherId, ref.academicYearId, ref.classSectionId, c, win);
          if (clash) {
            const reason = `${teacher.firstName} ${teacher.lastName} teaches ${clash.classLabel} in this period${clash.from ? ` from ${clash.from}` : ''}.`.replace('  ', ' ');
            if (opts.strict) throw new ApiError('TEACHER_CONFLICT', reason, 409, 'teacherId');
            skipped.push({ ...c, reason });
            continue;
          }
          const key = { schoolId, classSectionId: ref.classSectionId, dayOfWeek: c.dayOfWeek, periodId: c.periodId, academicYearId: ref.academicYearId };
          const versions = await tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY, where: key, select: { id: true, effectiveFrom: true, effectiveTo: true, subjectId: true, teacherId: true } });
          const ops = planSplice(versions, win.from, win.until, { subjectId: ref.subjectId, teacherId: ref.teacherId });
          await applySplice(tx, key, ops);
          const now = await tx.timetableSlot.findFirst({ where: { ...key, ...liveOn(win.from) }, include: SLOT_INCLUDE });
          if (now) slots.push(now);
        }
        return { slots, skipped };
      });
    } catch (e) {
      // A race the lock cannot see (the same CLASS period changed by two
      // offices at once) surfaces as the unique index; say what to do.
      if (isP2002(e)) {
        const target = p2002Target(e);
        if (target.includes('teacher')) throw new ApiError('TEACHER_CONFLICT', 'That teacher is already booked in that period', 409, 'teacherId');
        throw new BadRequestException('This period was just changed by someone else — reload and try again');
      }
      throw e;
    }
  }

  /** [from, until) for a change: from never before today (past weeks are as they were taught); until after from. */
  private window(from?: string, until?: string): { from: Date; until: Date | null } {
    const today = startOfIstDay(new Date());
    const asked = from ? resolveAsOfDate(from, new Date()) : today;
    const f = asked < today ? today : asked;
    const u = until ? resolveAsOfDate(until, new Date()) : null;
    if (u && u <= f) throw new ApiError('VALIDATION', 'A change for one week has to end after it starts.', 400, 'until');
    return { from: f, until: u };
  }

  /** The teacher's version in ANOTHER class, this weekday and period, overlapping the window. */
  private async clashFor(tx: TenantTx, schoolId: string, teacherId: string, academicYearId: string, classSectionId: string, c: { dayOfWeek: number; periodId: string }, win: { from: Date; until: Date | null }) {
    const hit = await tx.timetableSlot.findFirst({
      where: {
        schoolId, teacherId, academicYearId, dayOfWeek: c.dayOfWeek, periodId: c.periodId,
        classSectionId: { not: classSectionId },
        ...(win.until ? { effectiveFrom: { lt: win.until } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: win.from } }],
      },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
    });
    if (!hit) return null;
    return {
      classLabel: `${hit.classSection.grade.name}-${hit.classSection.name}`,
      // Only worth saying when the clash begins later than the change does.
      from: hit.effectiveFrom > win.from ? shortDayDate(hit.effectiveFrom) : null,
    };
  }

  /**
   * Dated things a swap disturbs, on the days it covers (at most the next two
   * weeks of an open-ended change). None of them block — each is something
   * the office should know before pressing Save.
   */
  private async warningsFor(tx: TenantTx, schoolId: string, teacherId: string, classSectionId: string, c: { dayOfWeek: number; periodId: string }, win: { from: Date; until: Date | null }, currentTeacherName: string | null): Promise<string[]> {
    const horizon = new Date(win.from.getTime() + 14 * 86_400_000);
    const stop = win.until && win.until < horizon ? win.until : horizon;
    const dates: string[] = [];
    for (let t = win.from.getTime(); t < stop.getTime(); t += 86_400_000) {
      const day = istDay(new Date(t));
      if ((new Date(`${day}T00:00:00Z`).getUTCDay() || 7) === c.dayOfWeek) dates.push(day);
    }
    if (!dates.length) return [];
    const asDates = dates.map((x) => new Date(`${x}T00:00:00Z`));
    const [leave, covering, arranged] = await Promise.all([
      tx.leaveApplication.findMany({ take: 20, where: { schoolId, teacherId, status: 'APPROVED', OR: asDates.map((x) => ({ startDate: { lte: x }, endDate: { gte: x } })) }, select: { startDate: true, endDate: true } }),
      tx.substitution.findMany({ take: 20, where: { schoolId, substituteTeacherId: teacherId, periodId: c.periodId, date: { in: asDates } }, select: { date: true, classSectionId: true } }),
      tx.substitution.findMany({ take: 20, where: { schoolId, classSectionId, periodId: c.periodId, date: { in: asDates }, substituteTeacherId: { not: null } }, select: { date: true } }),
    ]);
    const out: string[] = [];
    for (const x of asDates) {
      if (leave.some((l) => l.startDate <= x && l.endDate >= x)) out.push(`On leave ${shortDayDate(x)} — this period will need cover.`);
    }
    if (covering.length) out.push(`Already covering another class in this period on ${covering.map((s) => shortDayDate(s.date)).join(', ')}.`);
    if (arranged.length) out.push(`Cover is already arranged here on ${arranged.map((s) => shortDayDate(s.date)).join(', ')}${currentTeacherName ? ` for ${currentTeacherName}` : ''} — check it in Leave.`);
    return out;
  }

  /**
   * `kind` and the clock times are part of the availability payload, not just
   * the timetable's.
   *
   * The availability grid has to draw a BREAK as a gap rather than as a period
   * where the whole staff is conveniently free, and it has to open on the
   * period that is actually running — an admin looking for cover almost always
   * wants the current hour or the next one. Both facts live here; without them
   * the client is left inferring a break from whether the label happens to
   * contain the word "lunch", which is a guess that breaks on the first school
   * that calls it "Recess".
   */
  private static readonly PERIOD_FIELDS = {
    id: true,
    order: true,
    label: true,
    kind: true,
    startTime: true,
    endTime: true,
  } as const;

  async availability(schoolId: string, query: AvailabilityQueryDto) {
    return withTenant(schoolId, async (tx) => {
      // Resolve the academic year: use query param if provided, else fall back to isCurrent.
      let academicYearId = query.academicYearId;
      if (!academicYearId) {
        const current = await tx.academicYear.findFirst({
          where: { schoolId, isCurrent: true },
        });
        if (!current) {
          // No current year — return teachers + periods with an empty busy list.
          const [teachers, periods] = await Promise.all([
            tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
              where: { schoolId, isActive: true },
              select: { id: true, firstName: true, lastName: true },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            }),
            tx.period.findMany({ take: LIST_CEILING.STRUCTURE,
              where: { schoolId },
              select: TimetableService.PERIOD_FIELDS,
              orderBy: { order: 'asc' },
            }),
          ]);
          return { teachers, periods, busy: [] };
        }
        academicYearId = current.id;
      }

      const [teachers, periods, slots] = await Promise.all([
        tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
        tx.period.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId },
          select: TimetableService.PERIOD_FIELDS,
          orderBy: { order: 'asc' },
        }),
        tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, academicYearId, effectiveTo: null },
          select: { teacherId: true, dayOfWeek: true, periodId: true },
        }),
      ]);

      return { teachers, periods, busy: slots };
    });
  }

  /**
   * The caller's own active slots for the whole week, as of `date`
   * (default today). Same effectiveFrom/effectiveTo versioning as
   * `listForClass`, so a past date returns the timetable as it stood then.
   */
  async listForTeacher(schoolId: string, userId: string, date?: string): Promise<TimetableSlot[]> {
    const asOf = resolveAsOfDate(date, new Date());
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { schoolId, userId } });
      if (!teacher) return [];
      return tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY,
        where: {
          schoolId,
          teacherId: teacher.id,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
        include: SLOT_INCLUDE,
      });
    });
  }

  /**
   * Remove the period from the viewed week on (`from`, never before today),
   * or for that week only (`until`). The weeks before stay as they were; a
   * version that started today has no earlier part and is removed outright.
   * `id` is any version of the period — the grid hands over the one it shows.
   */
  async unassign(schoolId: string, id: string, q: { from?: string; until?: string } = {}) {
    const win = this.window(q.from, q.until);
    await withTenant(schoolId, async (tx) => {
      const slot = await tx.timetableSlot.findFirst({ where: { id, schoolId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');
      const key = { schoolId, classSectionId: slot.classSectionId, dayOfWeek: slot.dayOfWeek, periodId: slot.periodId, academicYearId: slot.academicYearId };
      const versions = await tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY, where: key, select: { id: true, effectiveFrom: true, effectiveTo: true, subjectId: true, teacherId: true } });
      const ops = planSplice(versions, win.from, win.until, null);
      if (!ops.length) throw new NotFoundException('Timetable slot not found');
      await applySplice(tx, key, ops);
    });
  }
}
