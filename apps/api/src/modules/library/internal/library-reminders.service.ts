import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { getLibraryPlatformPrisma } from '@library/db';
import { emitNotifications } from '../../../common/notifications/notification-inbox';

/**
 * "Your book goes back tomorrow", and nothing about money.
 *
 * P3 deliberately sends no money notification of any kind, which is what makes
 * "no push saying you owe ₹300" true by construction. This is the first library
 * message the product sends, so the rule is set here on purpose: reminders talk
 * about BOOKS AND DATES. Not amounts, not "dues", not "outstanding". A child
 * who is a day late has done nothing wrong, and a family that receives a
 * money-shaped alert from a library that mostly charges nothing learns to
 * expect charges.
 *
 * TEACHERS ARE NOT NAGGED LIKE CHILDREN. A teacher is a colleague with a
 * timetable, not a borrower who needs chasing; the fastest way to make a
 * staffroom mute a channel is to message it every morning about the same book.
 * So students hear on day 1 and then weekly, and teachers only weekly. The
 * difference is deliberate politics, not an oversight.
 *
 * DAILY, ONCE. Vercel's Hobby plan permits daily crons only, and no state
 * transition may depend on a scheduler — nothing here changes a status. It
 * reads what is already true from `dueAt` and writes inbox rows.
 */

export interface LibraryReminderRunResult {
  /** Schools whose library was looked at. */
  orgs: number;
  dueTomorrow: number;
  overdue: number;
  /** Members with no linked Sckools login — they cannot be told anything. */
  unreachable: number;
  /** Skipped because the same reminder already went out today. */
  alreadySentToday: number;
}

/** Whole days between two instants, floored toward the past. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Whether a borrower hears about this book today.
 *
 * Day 1 then weekly for a child; weekly only for a teacher. Returning false
 * most days is the point — a reminder that arrives every morning is one nobody
 * reads by the third.
 */
export function shouldRemind(daysLate: number, memberType: string): boolean {
  if (daysLate < 1) return false;
  if (memberType === 'TEACHER') return daysLate % 7 === 0;
  return daysLate === 1 || daysLate % 7 === 0;
}

@Injectable()
export class LibraryRemindersService {
  private readonly logger = new Logger(LibraryRemindersService.name);

  async run(now = new Date()): Promise<LibraryReminderRunResult> {
    const result: LibraryReminderRunResult = {
      orgs: 0,
      dueTomorrow: 0,
      overdue: 0,
      unreachable: 0,
      alreadySentToday: 0,
    };

    // The cron has no tenant, so this walks every LIVE library. The platform
    // client is correct HERE and only here: there is no request org to scope
    // to, and every query below carries an explicit `orgId` from this list.
    const orgs = await getLibraryPlatformPrisma().libraryOrg.findMany({
      where: { status: 'LIVE', schoolId: { not: null } },
      select: { id: true, schoolId: true },
    });

    for (const org of orgs) {
      if (!org.schoolId) continue;
      result.orgs += 1;
      try {
        await this.runForOrg(org.id, org.schoolId, now, result);
      } catch (err) {
        // One school's library must not stop every other school's reminders.
        this.logger.error(
          `library reminders failed for org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }

  private async runForOrg(
    orgId: string,
    schoolId: string,
    now: Date,
    result: LibraryReminderRunResult,
  ): Promise<void> {
    const prisma = getLibraryPlatformPrisma();

    const open = await prisma.issue.findMany({
      where: { orgId, returnedAt: null },
      select: {
        id: true,
        dueAt: true,
        member: { select: { externalRef: true, memberType: true, status: true } },
        copy: { select: { title: { select: { title: true } } } },
      },
    });

    interface Pending {
      userId: string;
      issueId: string;
      title: string;
      body: string;
    }
    const pending: Pending[] = [];

    for (const issue of open) {
      if (issue.member.status !== 'ACTIVE') continue;
      // No linked Sckools login — nothing to send to. Counted rather than
      // silently dropped, because a school with many of these has an
      // enrolment problem worth surfacing.
      if (!issue.member.externalRef) {
        result.unreachable += 1;
        continue;
      }

      const daysLeft = daysBetween(now, issue.dueAt);
      const bookTitle = issue.copy.title.title;

      if (daysLeft === 1) {
        result.dueTomorrow += 1;
        pending.push({
          userId: issue.member.externalRef,
          issueId: issue.id,
          title: 'A library book goes back tomorrow',
          body: bookTitle,
        });
        continue;
      }

      const daysLate = -daysLeft;
      if (shouldRemind(daysLate, issue.member.memberType)) {
        result.overdue += 1;
        pending.push({
          userId: issue.member.externalRef,
          issueId: issue.id,
          // Days, never rupees — and never the word "overdue", which reads as
          // a penalty notice. The library wants the book back, not a fine.
          title: daysLate === 1 ? 'A library book was due yesterday' : `A library book is ${daysLate} days late`,
          body: bookTitle,
        });
      }
    }

    if (pending.length === 0) return;

    // Already told today? The cron is idempotent by CHECKING, not by a unique
    // index: `Notification` has none, and a re-run (an operator curl, a Vercel
    // retry) must not tell a child twice about one book. `linkId` carries the
    // issue id precisely so this lookup is possible.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await getPlatformPrisma().notification.findMany({
      where: {
        schoolId,
        kind: 'LIBRARY',
        linkType: 'LIBRARY_ISSUE',
        linkId: { in: pending.map((p) => p.issueId) },
        createdAt: { gte: startOfDay },
      },
      select: { linkId: true, userId: true },
    });
    const already = new Set(sentToday.map((n) => `${n.userId}:${n.linkId}`));

    const toSend = pending.filter((p) => !already.has(`${p.userId}:${p.issueId}`));
    result.alreadySentToday += pending.length - toSend.length;
    if (toSend.length === 0) return;

    await withTenant(schoolId, async (tx) => {
      for (const p of toSend) {
        await emitNotifications(tx, {
          schoolId,
          userIds: [p.userId],
          kind: 'LIBRARY',
          title: p.title,
          body: p.body,
          linkType: 'LIBRARY_ISSUE',
          linkId: p.issueId,
        });
      }
    });
  }
}
