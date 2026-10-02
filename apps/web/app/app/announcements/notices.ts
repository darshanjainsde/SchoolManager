/**
 * ONE NOTICE, NOT ONE ROW PER CLASS.
 *
 * `POST /manage/announcements` writes one Announcement row per targeted class
 * section, so a notice sent to fifteen classes comes back as fifteen rows
 * carrying the same title and the same message. Rendered straight out, the
 * admin's list was fifteen lines that looked like fifteen notices — and the
 * only thing distinguishing them was a pill reading "B".
 *
 * These helpers are pure and live apart from the page so they can be read
 * against the real numbers in a test: 45 sections, a year of posts, a title
 * that is a whole sentence.
 */

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  classSectionId: string | null;
  /** `grade` arrives from the API so the cell can say "IX-B" and not "B". */
  classSection: { name: string; grade: { name: string } } | null;
  createdAt: string;
}

export interface Notice {
  /** Stable across refetches: the first row's id. */
  key: string;
  title: string;
  body: string;
  postedAt: string;
  /** Every row this notice was written as — what Edit and Delete act on. */
  rows: AnnouncementRow[];
  audience: 'SCHOOL' | 'CLASSES';
  /** "IX-B", in the order they were posted. Empty for a whole-school notice. */
  classNames: string[];
}

/**
 * One `create()` writes its rows back to back, so the rows of a notice are
 * adjacent in the newest-first list and milliseconds apart. Two minutes is
 * far wider than that and far narrower than a repost, and it also covers the
 * case the obvious "same minute" key gets wrong — a fan-out that straddles a
 * minute boundary.
 */
const SAME_POST_MS = 120_000;

/** Groups the API's rows into the notices a person actually posted. Order is preserved. */
export function groupNotices(rows: AnnouncementRow[]): Notice[] {
  const out: Notice[] = [];
  for (const row of rows) {
    const open = out[out.length - 1];
    const sameWords = open && open.title === row.title && open.body === row.body;
    const closeEnough =
      open && Math.abs(new Date(row.createdAt).getTime() - new Date(open.postedAt).getTime()) <= SAME_POST_MS;
    if (open && sameWords && closeEnough) {
      open.rows.push(row);
      if (row.classSection) open.classNames.push(label(row.classSection));
      continue;
    }
    out.push({
      key: row.id,
      title: row.title,
      body: row.body,
      postedAt: row.createdAt,
      rows: [row],
      audience: row.classSectionId === null ? 'SCHOOL' : 'CLASSES',
      classNames: row.classSection ? [label(row.classSection)] : [],
    });
  }
  return out;
}

const label = (cs: { name: string; grade: { name: string } }) => `${cs.grade.name}-${cs.name}`;

/** How many classes to name before the cell starts counting instead. */
const NAMED = 3;

export interface Audience {
  /** The sentence for the cell: "Whole school", "15 classes". */
  summary: string;
  /** The first few named, so a two-class notice reads as its classes. */
  shown: string[];
  more: number;
}

/**
 * A notice to thirty classes cannot print thirty class names in a list row —
 * it would be the widest thing on the page and no one would read past the
 * third. Name a few, count the rest, and let the drawer show them all.
 */
export function audienceOf(notice: Notice): Audience {
  if (notice.audience === 'SCHOOL') return { summary: 'Whole school', shown: [], more: 0 };
  const n = notice.rows.length;
  // One class is its own best label: a pill reading "1 class" with "XII-B"
  // underneath spends two lines saying one thing.
  if (n === 1) return { summary: notice.classNames[0] ?? '1 class', shown: [], more: 0 };
  return {
    summary: `${n} classes`,
    shown: notice.classNames.slice(0, NAMED),
    more: Math.max(0, notice.classNames.length - NAMED),
  };
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * "Today" and "Yesterday" are what an admin says out loud about a notice they
 * just sent; past that a date is clearer than "9 days ago". The year appears
 * only once it is not this one, so the common case stays short.
 */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The exact moment, for the drawer — a notice's time matters when it is about today. */
export function postedAtLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
