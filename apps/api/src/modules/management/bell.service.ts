import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { MorningBell } from '@skoolos/types';
import { FeatureResolverService } from '../features';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { LeaveService } from './leave.service';

/**
 * The Morning Bell — the principal's first look of the day.
 *
 * Everything here is COMPUTED at read time from tables other features already
 * maintain; there is no stored digest and no cron (the compute-don't-store
 * rule: the number on the card is the number in the register, always). When
 * an outbound channel exists (WhatsApp, email), a send job will call this
 * same composer and snapshot its output — the composer never changes.
 *
 * Every line is designed to link to the screen that FIXES it. A queue, never
 * a report.
 */

const IST = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today as the IST calendar day, in the three shapes the queries need. */
export function istToday(now = new Date()): { dateOnly: Date; dayStartUtc: Date; label: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now); // yyyy-mm-dd
  const dateOnly = new Date(ymd); // matches @db.Date columns (UTC midnight)
  return {
    dateOnly,
    dayStartUtc: new Date(dateOnly.getTime() - IST_OFFSET_MS),
    label: new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long' }).format(now),
  };
}

@Injectable()
export class BellService {
  constructor(
    private readonly leave: LeaveService,
    private readonly features: FeatureResolverService,
  ) {}

  async compose(schoolId: string, now = new Date()): Promise<MorningBell> {
    const { dateOnly, dayStartUtc, label } = istToday(now);
    const ymd = dateOnly.toISOString().slice(0, 10);
    const yesterdayStartUtc = new Date(dayStartUtc.getTime() - 24 * 60 * 60 * 1000);
    const monthStartUtc = (() => {
      const first = new Date(dateOnly);
      first.setUTCDate(1);
      return new Date(first.getTime() - IST_OFFSET_MS);
    })();
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

    const hasFees = (await this.features.getFeatures(schoolId)).has('FEES');

    // The coverage service already knows how to label a gap ("Grade 6 — A",
    // period, whose class it was) — reuse it rather than re-deriving labels.
    // One 30-day sweep: today's gaps ring loudly; the rest count as the
    // early warning the old dashboard alert used to carry.
    const horizon = new Date(dateOnly.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const coverage = await this.leave.coverage(schoolId, ymd, horizon);
    const gaps = coverage.filter((g) => !g.substituteTeacherId);
    const isToday = (d: Date) => d.toISOString().slice(0, 10) === ymd;
    const uncovered = gaps
      .filter((g) => isToday(g.date))
      .map((g) => ({
        className: g.classSectionName,
        periodLabel: g.periodLabel,
        teacherName: g.originalTeacherName,
      }));
    const upcomingUncovered = gaps.filter((g) => !isToday(g.date)).length;

    return withTenant(schoolId, async (tx) => {
      const [staffMarks, attendance, holiday, events, leavePending, registerPending, enquiriesNew] =
        await Promise.all([
          tx.staffAttendance.findMany({
            where: { date: dateOnly, status: { in: ['ABSENT', 'ON_LEAVE'] } },
            select: { teacherId: true, staffId: true, status: true },
            take: LIST_CEILING.STRUCTURE,
          }),
          tx.attendance.groupBy({
            by: ['classSectionId', 'status'],
            where: { date: dateOnly },
            _count: { _all: true },
          }),
          tx.holiday.findFirst({
            where: {
              startDate: { lte: dateOnly },
              OR: [{ endDate: { gte: dateOnly } }, { endDate: null, startDate: dateOnly }],
            },
            select: { name: true },
          }),
          tx.event.findMany({
            where: { status: 'APPROVED', startAt: { gte: dayStartUtc, lt: dayEndUtc } },
            select: { title: true, startAt: true },
            orderBy: { startAt: 'asc' },
            take: 5,
          }),
          tx.leaveApplication.count({ where: { status: 'PENDING' } }),
          tx.registerChangeRequest.count({ where: { status: 'PENDING' } }),
          tx.enquiry.count({ where: { status: 'NEW' } }),
        ]);

      // ── who is not in ────────────────────────────────────────────────────
      const teacherIds = staffMarks.map((m) => m.teacherId).filter((v): v is string => !!v);
      const staffIds = staffMarks.map((m) => m.staffId).filter((v): v is string => !!v);
      const [teachers, staff] = await Promise.all([
        teacherIds.length
          ? tx.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, firstName: true, lastName: true } })
          : Promise.resolve([]),
        staffIds.length
          ? tx.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } })
          : Promise.resolve([]),
      ]);
      const teacherById = new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`.trim()]));
      const staffById = new Map(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]));
      const staffAbsent: MorningBell['staffAbsent'] = staffMarks
        .map((m) => {
          const status = m.status as 'ABSENT' | 'ON_LEAVE';
          if (m.teacherId) {
            const name = teacherById.get(m.teacherId);
            return name ? { name, kind: 'TEACHER' as const, status } : null;
          }
          if (m.staffId) {
            const name = staffById.get(m.staffId);
            return name ? { name, kind: 'STAFF' as const, status } : null;
          }
          return null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .sort((a, b) => a.name.localeCompare(b.name));

      // ── students ─────────────────────────────────────────────────────────
      let absent = 0;
      let marked = 0;
      const absentBySection = new Map<string, number>();
      for (const row of attendance) {
        const n = row._count._all;
        marked += n;
        if (row.status === 'ABSENT') {
          absent += n;
          absentBySection.set(row.classSectionId, (absentBySection.get(row.classSectionId) ?? 0) + n);
        }
      }
      let worst: MorningBell['students']['worst'] = null;
      if (absentBySection.size > 0) {
        const [sectionId, count] = [...absentBySection.entries()].sort((a, b) => b[1] - a[1])[0]!;
        const section = await tx.classSection.findFirst({
          where: { id: sectionId },
          select: { name: true, grade: { select: { name: true } } },
        });
        worst = { className: section ? `${section.grade.name}-${section.name}` : 'Unknown class', absent: count };
      }

      // ── fees (only when the school runs the module) ──────────────────────
      let fees: MorningBell['fees'] = null;
      if (hasFees) {
        const [yesterday, month, waitingPayments] = await Promise.all([
          tx.feePayment.aggregate({
            where: { status: 'VERIFIED', verifiedAt: { gte: yesterdayStartUtc, lt: dayStartUtc } },
            _sum: { amountMinor: true },
          }),
          tx.feePayment.aggregate({
            where: { status: 'VERIFIED', verifiedAt: { gte: monthStartUtc } },
            _sum: { amountMinor: true },
          }),
          tx.feePayment.count({ where: { status: 'SUBMITTED' } }),
        ]);
        fees = {
          yesterdayMinor: yesterday._sum.amountMinor ?? 0,
          monthMinor: month._sum.amountMinor ?? 0,
          awaitingReview: waitingPayments,
        };
      }

      return {
        dateLabel: label,
        staffAbsent,
        uncovered,
        upcomingUncovered,
        students: { absent, marked, worst },
        fees,
        today: {
          holiday: holiday?.name ?? null,
          events: events.map((e) => ({
            title: e.title,
            time: new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(e.startAt),
          })),
        },
        waiting: { leave: leavePending, registerChanges: registerPending, enquiries: enquiriesNew },
      };
    });
  }
}
