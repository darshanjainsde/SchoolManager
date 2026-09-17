import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, resolveFeatures, type Prisma } from '@skoolos/db';
import type { FeeDecisionOutboxPayload } from '../../common/notifications/notification.types';
import { istTodayISO } from '../../common/dates/timetable-date';
import { formatRupees } from './money';

/** Told twice: a week before the due date, and on the day. Date-exact, so each fires once. */
const LEADS = [7, 0] as const;
const MAX_PER_RUN = 500;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000);

/**
 * THE FEE_DUE SENDER (`/internal/cron/fee-due-soon`). The kind existed with
 * no sender; without one a family learns a bill is due by opening the app.
 * Every bill still owing whose due date is exactly a week away, or today,
 * gets one bell row and one push to the student's login. Runs on the
 * platform client — a cron has no tenant — with every write scoped by the
 * row's own schoolId, like the library's due-soon nudge it mirrors.
 * Date-exact targeting makes the daily run idempotent.
 */
@Injectable()
export class FeeDueSoonService {
  private readonly logger = new Logger(FeeDueSoonService.name);

  async run() {
    const db = getPlatformPrisma();
    const today = istTodayISO();
    const targets = LEADS.map((n) => addDays(today, n));
    const invoices = await db.feeInvoice.findMany({
      where: { cancelledAt: null, dueDate: { in: targets } },
      take: MAX_PER_RUN,
      include: {
        allocations: { select: { amountMinor: true } },
        term: { select: { name: true } },
        student: { select: { userId: true, firstName: true } },
      },
    });
    if (invoices.length === MAX_PER_RUN) this.logger.warn(`fee-due-soon hit the ${MAX_PER_RUN}-row cap — some families were not told.`);
    if (!invoices.length) return { schools: 0, notices: 0 };

    const schoolIds = [...new Set(invoices.map((i) => i.schoolId))];
    const [schools, overrides] = await Promise.all([
      db.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true, tier: true } }),
      db.featureOverride.findMany({ where: { schoolId: { in: schoolIds } } }),
    ]);
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    const overridesBySchool = new Map<string, { featureKey: string; enabled: boolean }[]>();
    for (const o of overrides) overridesBySchool.set(o.schoolId, [...(overridesBySchool.get(o.schoolId) ?? []), o]);

    let notices = 0;
    const active = new Set<string>();
    for (const inv of invoices) {
      const school = schoolById.get(inv.schoolId);
      if (!school) continue;
      if (!resolveFeatures(school.tier, overridesBySchool.get(inv.schoolId) ?? []).has('FEES')) continue;
      const userId = inv.student?.userId;
      if (!userId) continue;
      const outstanding = inv.totalMinor - inv.allocations.reduce((a, x) => a + x.amountMinor, 0);
      if (outstanding <= 0) continue;

      const dueISO = inv.dueDate.toISOString().slice(0, 10);
      const onTheDay = dueISO === today;
      const title = onTheDay
        ? `${inv.term.name} fees due today — ${formatRupees(outstanding)}`
        : `${inv.term.name} fees due in a week — ${formatRupees(outstanding)}`;
      const body = onTheDay
        ? 'Pay by bank transfer from the Fees page, or at the office.'
        : `Due ${new Date(dueISO).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}. Pay from the Fees page whenever suits.`;

      await db.notification.create({
        data: { schoolId: inv.schoolId, userId, kind: 'FEE_DUE', title, body, linkType: 'fees', linkId: inv.id },
      });
      await db.notificationOutbox.create({
        data: {
          schoolId: inv.schoolId,
          kind: 'FEE_DUE',
          targetUserId: userId,
          payload: { schoolName: school.name, title, body } satisfies FeeDecisionOutboxPayload as unknown as Prisma.InputJsonValue,
        },
      });
      notices++;
      active.add(inv.schoolId);
    }
    this.logger.log({ schools: active.size, notices }, 'fee-due-soon run');
    return { schools: active.size, notices };
  }
}
