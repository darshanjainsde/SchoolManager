import { describe, it, expect } from 'vitest';
import { groupNotices, audienceOf, whenLabel, type AnnouncementRow } from './notices';

/**
 * ONE NOTICE, NOT ONE ROW PER CLASS.
 *
 * `POST /manage/announcements` writes ONE Announcement row PER targeted class
 * section (AnnouncementsService.create). The admin list rendered those rows
 * straight out, so a single notice sent to fifteen classes filled fifteen
 * lines of the page with the same title and the same message — and the only
 * thing telling them apart was a pill reading "B". An admin looking for "the
 * notice I sent about the PTM" was reading a list of rows, not of notices.
 *
 * The rows arrive newest-first and a create() writes its rows back to back,
 * so a notice is a run of adjacent rows with the same words, posted at the
 * same moment. The same words posted again next week are a DIFFERENT notice
 * and must stay apart — the sample school has "Library period" sent to IV-A
 * on 24 September and to IX-B on 1 October.
 */
const row = (over: Partial<AnnouncementRow> & { id: string }): AnnouncementRow => ({
  title: 'Half-Yearly results and PTM',
  body: 'Results will be shared at the Parent–Teacher Meeting.',
  classSectionId: null,
  classSection: null,
  createdAt: '2026-09-24T09:00:00.000Z',
  ...over,
});

const inClass = (id: string, grade: string, name: string, at: string): AnnouncementRow =>
  row({ id, classSectionId: `cs-${id}`, classSection: { name, grade: { name: grade } }, createdAt: at });

describe('grouping the rows into notices', () => {
  it('folds one post to many classes into a single notice that names them', () => {
    const notices = groupNotices([
      inClass('a', 'IX', 'A', '2026-10-01T10:00:00.000Z'),
      inClass('b', 'IX', 'B', '2026-10-01T10:00:00.400Z'),
      inClass('c', 'X', 'A', '2026-10-01T10:00:00.800Z'),
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0].classNames).toEqual(['IX-A', 'IX-B', 'X-A']);
    expect(notices[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(notices[0].audience).toBe('CLASSES');
  });

  it('keeps the same words posted on another day apart', () => {
    const notices = groupNotices([
      inClass('new', 'IX', 'B', '2026-10-01T10:00:00.000Z'),
      inClass('old', 'IV', 'A', '2026-09-24T10:00:00.000Z'),
    ]);
    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.classNames)).toEqual([['IX-B'], ['IV-A']]);
  });

  it('does not fold two different notices posted in the same minute', () => {
    const notices = groupNotices([
      row({ id: 'a', title: 'Sports day' }),
      row({ id: 'b', title: 'Fee reminder' }),
    ]);
    expect(notices.map((n) => n.title)).toEqual(['Sports day', 'Fee reminder']);
  });

  it('holds a run together across a minute boundary — one create, two sides of midnight', () => {
    const notices = groupNotices([
      inClass('a', 'IX', 'A', '2026-10-01T18:29:59.900Z'),
      inClass('b', 'IX', 'B', '2026-10-01T18:30:00.100Z'),
    ]);
    expect(notices).toHaveLength(1);
  });

  it('a whole-school notice is one row and says so', () => {
    const notices = groupNotices([row({ id: 'x' })]);
    expect(notices[0].audience).toBe('SCHOOL');
    expect(notices[0].classNames).toEqual([]);
  });

  it('keeps the newest first, as the API sent them', () => {
    const notices = groupNotices([
      row({ id: 'new', title: 'B', createdAt: '2026-10-02T10:00:00.000Z' }),
      row({ id: 'old', title: 'A', createdAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(notices.map((n) => n.title)).toEqual(['B', 'A']);
  });

  it('survives a row whose class was deleted — no grade, no crash', () => {
    const orphan = row({ id: 'o', classSectionId: 'gone', classSection: null });
    expect(groupNotices([orphan])[0].audience).toBe('CLASSES');
    expect(groupNotices([orphan])[0].classNames).toEqual([]);
  });
});

describe('what the audience cell says', () => {
  it('names up to three classes and counts the rest, so a wide post does not fill the row', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      inClass(`c${i}`, 'IX', String.fromCharCode(65 + i), '2026-10-01T10:00:00.000Z'),
    );
    const a = audienceOf(groupNotices(many)[0]);
    expect(a.shown).toEqual(['IX-A', 'IX-B', 'IX-C']);
    expect(a.more).toBe(12);
    expect(a.summary).toBe('15 classes');
  });

  it('is the class itself when there is only one — "1 class · XII-B" says it twice', () => {
    const one = audienceOf(groupNotices([inClass('a', 'XII', 'B', '2026-10-01T10:00:00.000Z')])[0]);
    expect(one.summary).toBe('XII-B');
    expect(one.shown).toEqual([]);
    expect(one.more).toBe(0);

    const school = audienceOf(groupNotices([row({ id: 'x' })])[0]);
    expect(school.summary).toBe('Whole school');
    expect(school.shown).toEqual([]);
  });

  it('falls back to counting when the one class it went to has since been deleted', () => {
    const orphan = row({ id: 'o', classSectionId: 'gone', classSection: null });
    expect(audienceOf(groupNotices([orphan])[0]).summary).toBe('1 class');
  });
});

describe('when it went out', () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  it('says today and yesterday in words, and dates anything older', () => {
    expect(whenLabel('2026-10-02T09:00:00.000Z', now)).toBe('Today');
    expect(whenLabel('2026-10-01T09:00:00.000Z', now)).toBe('Yesterday');
    // en-GB abbreviates September to "Sept" and every other month to three letters;
    // that is what the rest of the console already prints ("24 Sept 2026").
    expect(whenLabel('2026-09-24T09:00:00.000Z', now)).toBe('24 Sept');
    expect(whenLabel('2026-08-24T09:00:00.000Z', now)).toBe('24 Aug');
  });

  it('carries the year once it is not this one', () => {
    expect(whenLabel('2025-09-24T09:00:00.000Z', now)).toBe('24 Sept 2025');
  });
});
