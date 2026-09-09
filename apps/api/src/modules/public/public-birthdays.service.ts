import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { withTenant } from '@skoolos/db';
import { normalizeCelebrationsConfig, type CelebrationsConfig } from '../cms';
import { activeStudentsWhere } from '../../common/roster/active-students';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import {
  daysUntil,
  effectiveDayMonth,
  formatName,
  inWindow,
  secondsToMidnight,
  todayInZone,
  windowBounds,
  ymdString,
  type BirthdayWindow,
} from '../../common/dates/birthdays';

/**
 * One birthday on the wall. Day and month ONLY — never a year, an age, a date
 * string or a student id. `key` is a short hash for React keys, not the id.
 */
export interface BirthdayRow {
  day: number;
  month: number;
  name: string;
  classLabel: string | null;
  photoUrl: string | null;
  key: string;
}

export interface BirthdaysResult {
  /** The school's "today", YYYY-MM-DD in its own timezone. */
  generatedFor: string;
  window: BirthdayWindow;
  today: BirthdayRow[];
  upcoming: BirthdayRow[];
  /** The first upcoming birthday, for the "Next: Meera, Thursday" empty state. */
  next: BirthdayRow | null;
  /** Seconds until the school's next midnight — the public cache lifetime. */
  maxAge: number;
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

/**
 * The birthday wall's rows (Active Roster, Track B).
 *
 * Reads ACTIVE students who are on the wall (`showOnWebsite`) and have a date of
 * birth, in the school's timezone, and answers 404 unless the homepage switch is
 * on AND the configured audience allows this caller: the public host gets
 * PUBLIC/BOTH, a signed-in family gets FAMILIES/BOTH. Photos ride only on a
 * per-child consent (D4).
 */
@Injectable()
export class PublicBirthdaysService {
  async forAudience(
    schoolId: string,
    audience: 'PUBLIC' | 'FAMILIES',
    windowParam?: string,
    now: Date = new Date(),
  ): Promise<BirthdaysResult> {
    return withTenant(schoolId, async (tx) => {
      const [school, homepage, profile] = await Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { name: true, timezone: true } }),
        tx.homepageContent.findUnique({ where: { schoolId }, select: { showBirthdays: true } }),
        tx.schoolProfile.findUnique({ where: { schoolId }, select: { celebrationsConfig: true } }),
      ]);
      if (!school || !homepage?.showBirthdays) throw new NotFoundException('Not found');
      const cfg = normalizeCelebrationsConfig(profile?.celebrationsConfig);
      if (!(cfg.audience === 'BOTH' || cfg.audience === audience)) throw new NotFoundException('Not found');

      const window = isWindow(windowParam) ? windowParam : cfg.window;
      const today = todayInZone(school.timezone, now);
      const { start, end } = windowBounds(window, today);

      const rows = cfg.source === 'MANUAL' ? manualRows(cfg, start, end) : await studentRows(tx, schoolId, cfg, start, end, today.y);

      const isToday = (r: BirthdayRow) => r.month === today.m && r.day === today.d;
      const sorted = rows.sort(
        (a, b) => daysUntil(a.day, a.month, today) - daysUntil(b.day, b.month, today) || a.name.localeCompare(b.name),
      );
      const todayRows = sorted.filter(isToday);
      const upcoming = sorted.filter((r) => !isToday(r));
      return {
        generatedFor: ymdString(today),
        window,
        today: todayRows,
        upcoming,
        next: upcoming[0] ?? null,
        maxAge: secondsToMidnight(school.timezone, now),
      };
    });
  }
}

function isWindow(v: string | undefined): v is BirthdayWindow {
  return v === 'TODAY' || v === 'WEEK' || v === 'MONTH';
}

function manualRows(cfg: CelebrationsConfig, start: { y: number; m: number; d: number }, end: { y: number; m: number; d: number }): BirthdayRow[] {
  return cfg.manual
    .filter((m) => inWindow(new Date(Date.UTC(2000, m.month - 1, m.day)), start, end))
    .map((m) => ({
      day: m.day,
      month: m.month,
      name: m.name,
      classLabel: cfg.showClass ? m.classLabel : null,
      photoUrl: null,
      key: hash(`${m.name}|${m.month}|${m.day}`),
    }));
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function studentRows(
  tx: Tx,
  schoolId: string,
  cfg: CelebrationsConfig,
  start: { y: number; m: number; d: number },
  end: { y: number; m: number; d: number },
  year: number,
): Promise<BirthdayRow[]> {
  const students = await tx.student.findMany({
    take: LIST_CEILING.ROSTER,
    where: activeStudentsWhere(schoolId, { showOnWebsite: true, dob: { not: null } }),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      photoConsent: true,
      photoAssetId: true,
      classSection: { select: { name: true, grade: { select: { name: true } } } },
    },
  });
  const hit = students.filter((s) => s.dob && inWindow(s.dob, start, end));
  const assetIds = cfg.showPhotos ? hit.filter((s) => s.photoConsent && s.photoAssetId).map((s) => s.photoAssetId!) : [];
  const urls = new Map<string, string>();
  if (assetIds.length) {
    const assets = await tx.mediaAsset.findMany({
      take: LIST_CEILING.ROSTER,
      where: { schoolId, id: { in: assetIds } },
      select: { id: true, url: true },
    });
    for (const a of assets) urls.set(a.id, a.url);
  }
  return hit.map((s) => {
    const { m, d } = effectiveDayMonth(s.dob!, year);
    return {
      day: d,
      month: m,
      name: formatName(s.firstName, s.lastName, cfg.nameFormat),
      classLabel: cfg.showClass && s.classSection ? `${s.classSection.grade.name} ${s.classSection.name}` : null,
      photoUrl: cfg.showPhotos && s.photoConsent && s.photoAssetId ? (urls.get(s.photoAssetId) ?? null) : null,
      key: hash(s.id),
    };
  });
}
