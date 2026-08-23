import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, resolveFeatures, type Prisma } from '@skoolos/db';
import { MailService } from '../../../common/mail/mail.service';
import type { LibraryNoticeOutboxPayload } from '../../../common/notifications/notification.types';
import { istTodayISO } from '../../management';
import { addDaysISO, dateOnlyISO } from './library-policy';

/** Days before dueOn that the nudge goes out — the approved "3 days before". */
const LEAD_DAYS = 3;

/**
 * Hard ceiling per run, mirroring the outbox drain's cap: the serverless
 * function has `maxDuration: 60`, so an unbounded scan could be killed
 * mid-run. Overflow is logged loudly; tomorrow's run catches nothing (these
 * are date-exact), so the cap is sized far above any plausible school day.
 */
const MAX_NOTICES_PER_RUN = 500;

/**
 * The daily due-soon nudge (`/internal/cron/library-due-soon`): every open
 * loan due in exactly LEAD_DAYS days gets one push (outbox, guaranteed path),
 * one bell row, and one email. Runs on the platform client — a cron has no
 * tenant context and the rows span every school — with every downstream
 * lookup still scoped by each row's own `schoolId`, exactly like
 * `NotificationOutboxService.drain()`. Date-exact targeting makes the daily
 * run naturally idempotent: an issue is "due in 3 days" on one day only.
 */
@Injectable()
export class LibraryDueSoonService {
  private readonly logger = new Logger(LibraryDueSoonService.name);

  constructor(private readonly mail: MailService) {}

  async run() {
    const db = getPlatformPrisma();
    const todayISO = istTodayISO();
    const target = new Date(`${addDaysISO(todayISO, LEAD_DAYS)}T00:00:00.000Z`);

    const issues = await db.libraryIssue.findMany({
      where: { returnedOn: null, dueOn: target },
      take: MAX_NOTICES_PER_RUN,
      include: {
        copy: { select: { accessionNo: true, title: { select: { title: true } } } },
        student: { select: { firstName: true, lastName: true, userId: true } },
        teacher: { select: { firstName: true, lastName: true, userId: true } },
      },
    });
    if (issues.length === MAX_NOTICES_PER_RUN) {
      this.logger.warn(`library-due-soon hit the ${MAX_NOTICES_PER_RUN}-row cap — some loans were not nudged.`);
    }
    if (!issues.length) return { schools: 0, notices: 0, emails: 0 };

    const schoolIds = [...new Set(issues.map((i) => i.schoolId))];
    const [schools, overrides, settings] = await Promise.all([
      db.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true, tier: true } }),
      db.featureOverride.findMany({ where: { schoolId: { in: schoolIds } } }),
      db.librarySettings.findMany({ where: { schoolId: { in: schoolIds } } }),
    ]);
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    const overridesBySchool = new Map<string, { featureKey: string; enabled: boolean }[]>();
    for (const o of overrides) {
      overridesBySchool.set(o.schoolId, [...(overridesBySchool.get(o.schoolId) ?? []), o]);
    }
    // No settings row yet ⇒ the defaults apply, and the default is ON.
    const remindersOff = new Set(settings.filter((s) => !s.dueSoonReminders).map((s) => s.schoolId));

    let notices = 0;
    let emails = 0;
    const activeSchools = new Set<string>();

    for (const issue of issues) {
      const school = schoolById.get(issue.schoolId);
      if (!school) continue;
      if (remindersOff.has(issue.schoolId)) continue;
      const features = resolveFeatures(school.tier, overridesBySchool.get(issue.schoolId) ?? []);
      if (!features.has('LIBRARY')) continue;

      const reader = issue.student ?? issue.teacher;
      const userId = reader?.userId;
      if (!userId) continue;
      const readerName = reader ? `${reader.firstName} ${reader.lastName}`.trim() : 'Reader';
      const dueOn = dateOnlyISO(issue.dueOn);
      const title = `“${issue.copy.title.title}” is due in ${LEAD_DAYS} days`;
      const body = `Due ${dueOn} · ${issue.copy.accessionNo}. A little time left — no fine yet.`;

      const payload: LibraryNoticeOutboxPayload = { schoolName: school.name, title, body };
      await db.notificationOutbox.create({
        data: {
          schoolId: issue.schoolId,
          kind: 'LIBRARY_NOTICE',
          targetUserId: userId,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      await db.notification.create({
        data: { schoolId: issue.schoolId, userId, kind: 'ANNOUNCEMENT', title, body },
      });
      notices += 1;
      activeSchools.add(issue.schoolId);

      const user = await db.user.findFirst({
        where: { id: userId, schoolId: issue.schoolId },
        select: { email: true },
      });
      if (user?.email) {
        const sent = await this.mail.sendLetter(
          user.email,
          issue.schoolId,
          `${school.name} library — “${issue.copy.title.title}” due ${dueOn}`,
          {
            title: 'A library book is due back',
            intro: `${readerName}'s library book is due on ${dueOn}.`,
            rows: [
              { label: 'Book', value: issue.copy.title.title },
              { label: 'Copy', value: issue.copy.accessionNo },
              { label: 'Due', value: dueOn },
            ],
            note: 'Returning it on time keeps the shelf moving — and skips the fine.',
          },
        );
        if (sent) emails += 1;
      }
    }

    return { schools: activeSchools.size, notices, emails };
  }
}
