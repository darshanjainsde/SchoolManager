import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { withTenant } from '@skoolos/db';
import type { TvScreen, TvStatus } from '@skoolos/types';
import { TenantContextService } from '../tenancy';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

/**
 * Sckools TV — the reception-screen loop.
 *
 * A VIEW over data the school already maintains (notices, events, birthdays,
 * the gallery); the TV is never a thing to feed. The page is public but
 * useless without the school's display key in the URL: a lobby screen cannot
 * type a password, so the key IS the whole gate — one revocable string, and
 * the wrong one answers exactly like a school with no TV at all (404, never
 * "wrong key": whether a school runs a TV is not an anonymous caller's
 * business).
 */

const IST = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDay(now = new Date()): { dateOnly: Date; dayStartUtc: Date; label: string } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now);
  const dateOnly = new Date(ymd);
  return {
    dateOnly,
    dayStartUtc: new Date(dateOnly.getTime() - IST_OFFSET_MS),
    label: new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long' }).format(now),
  };
}

function clock(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** Constant-time-ish compare; length mismatch is an instant honest no. */
function keyMatches(stored: string, given: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class TvService {
  constructor(private readonly tenant: TenantContextService) {}

  // ── The screen ─────────────────────────────────────────────────────────────

  async screen(key: string | undefined, now = new Date()): Promise<TvScreen> {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
    const schoolId = ctx.schoolId;
    const { dateOnly, dayStartUtc, label } = istDay(now);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findFirst({
        where: { id: schoolId },
        select: { name: true, status: true, tvKey: true },
      });
      // One answer for every failure: no school, not live, TV off, wrong key.
      if (!school || school.status !== 'LIVE' || !school.tvKey || !key || !keyMatches(school.tvKey, key)) {
        throw new NotFoundException('Not found');
      }

      const [profile, announcements, events, holiday, gallery, birthdayRows] = await Promise.all([
        tx.schoolProfile.findFirst({
          where: { schoolId },
          select: { logoAssetId: true, brandColorPrimary: true, brandColorSecondary: true, festiveTheme: true },
        }),
        tx.announcement.findMany({
          // School-wide only — a class's internal note is not lobby material.
          where: { classSectionId: null },
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { title: true, body: true, createdAt: true },
        }),
        tx.event.findMany({
          where: { status: 'APPROVED', startAt: { gte: dayStartUtc } },
          orderBy: { startAt: 'asc' },
          take: 8,
          select: { title: true, startAt: true, venue: true },
        }),
        tx.holiday.findFirst({
          where: {
            startDate: { lte: dateOnly },
            OR: [{ endDate: { gte: dateOnly } }, { endDate: null, startDate: dateOnly }],
          },
          select: { name: true },
        }),
        tx.mediaAsset.findMany({
          where: { kind: 'GALLERY' },
          orderBy: { order: 'asc' },
          take: 8,
          select: { url: true },
        }),
        // Birthdays: month+day of dob equals today's IST month+day. Prisma
        // cannot express EXTRACT, so raw SQL — still under withTenant's RLS.
        tx.$queryRaw<{ firstName: string; lastName: string; className: string | null }[]>`
          SELECT s."firstName", s."lastName", (g."name" || '-' || cs."name") AS "className"
          FROM "Student" s
          LEFT JOIN "ClassSection" cs ON cs."id" = s."classSectionId"
          LEFT JOIN "Grade" g ON g."id" = cs."gradeId"
          WHERE s."isActive" = true
            AND s."dob" IS NOT NULL
            AND EXTRACT(MONTH FROM s."dob") = ${dateOnly.getUTCMonth() + 1}
            AND EXTRACT(DAY FROM s."dob") = ${dateOnly.getUTCDate()}
          ORDER BY s."firstName" ASC
          LIMIT 12`,
      ]);

      let logoUrl: string | null = null;
      if (profile?.logoAssetId) {
        const asset = await tx.mediaAsset.findFirst({ where: { id: profile.logoAssetId }, select: { url: true } });
        logoUrl = asset?.url ?? null;
      }
      const festive = profile?.festiveTheme as { festival?: string } | null;

      return {
        school: {
          name: school.name,
          logoUrl,
          ps1: profile?.brandColorPrimary ?? '#3ee6b0',
          ps2: profile?.brandColorSecondary ?? '#7c6cff',
          festival: festive?.festival ?? null,
        },
        dateLabel: label,
        holiday: holiday?.name ?? null,
        announcements: announcements.map((a) => ({
          title: a.title,
          body: a.body.length > 220 ? `${a.body.slice(0, 217)}…` : a.body,
          when: dayLabel(a.createdAt),
        })),
        eventsToday: events
          .filter((e) => e.startAt < dayEndUtc)
          .map((e) => ({ title: e.title, time: clock(e.startAt), venue: e.venue })),
        eventsUpcoming: events
          .filter((e) => e.startAt >= dayEndUtc)
          .slice(0, 3)
          .map((e) => ({ title: e.title, when: dayLabel(e.startAt), venue: e.venue })),
        birthdays: birthdayRows.map((b) => ({
          name: `${b.firstName} ${b.lastName}`.trim(),
          className: b.className,
        })),
        gallery: gallery.map((g) => g.url),
      };
    });
  }

  // ── The admin's switch ─────────────────────────────────────────────────────

  private url(host: string | null, key: string): string {
    return host ? `https://${host}/tv?key=${key}` : `/tv?key=${key}`;
  }

  async status(schoolId: string, host: string | null): Promise<TvStatus> {
    const school = await withTenant(schoolId, (tx) =>
      tx.school.findFirst({ where: { id: schoolId }, select: { tvKey: true } }),
    );
    return { enabled: !!school?.tvKey, url: school?.tvKey ? this.url(host, school.tvKey) : null };
  }

  /**
   * Enable, or rotate the key. Rotating kills every TV showing the old URL —
   * which is the point: an ex-vendor with the link loses it the moment the
   * office clicks once.
   */
  async rotate(schoolId: string, host: string | null): Promise<TvStatus> {
    const key = randomBytes(18).toString('base64url');
    await withTenant(schoolId, (tx) => tx.school.update({ where: { id: schoolId }, data: { tvKey: key } }));
    return { enabled: true, url: this.url(host, key) };
  }

  async disable(schoolId: string): Promise<TvStatus> {
    await withTenant(schoolId, (tx) => tx.school.update({ where: { id: schoolId }, data: { tvKey: null } }));
    return { enabled: false, url: null };
  }
}
