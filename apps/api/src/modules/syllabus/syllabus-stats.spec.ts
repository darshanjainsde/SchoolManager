import { chapterStatus, expectedPctOf, leavesOf, paceOf, reachPlan, trackStats } from './syllabus-stats';

const leaf = (id: string, status: 'NOT_STARTED' | 'TEACHING' | 'DONE' = 'NOT_STARTED') => ({ id, title: id, status });
const ch = (id: string, children: ReturnType<typeof leaf>[] = [], status: 'NOT_STARTED' | 'TEACHING' | 'DONE' = 'NOT_STARTED') => ({ ...leaf(id, status), children });

describe('syllabus stats', () => {
  describe('leaves and chapter status', () => {
    it('a chapter without sub-topics is its own leaf and keeps its own status', () => {
      const c = ch('c1', [], 'TEACHING');
      expect(leavesOf(c)).toEqual([expect.objectContaining({ id: 'c1' })]);
      expect(chapterStatus(c)).toBe('TEACHING');
    });
    it('a chapter with sub-topics is DONE only when every sub-topic is, TEACHING once any is touched', () => {
      expect(chapterStatus(ch('c', [leaf('a'), leaf('b')]))).toBe('NOT_STARTED');
      expect(chapterStatus(ch('c', [leaf('a', 'DONE'), leaf('b')]))).toBe('TEACHING');
      expect(chapterStatus(ch('c', [leaf('a'), leaf('b', 'TEACHING')]))).toBe('TEACHING');
      expect(chapterStatus(ch('c', [leaf('a', 'DONE'), leaf('b', 'DONE')]))).toBe('DONE');
    });
    it("a parent's own stored status is ignored once it has sub-topics", () => {
      expect(chapterStatus(ch('c', [leaf('a')], 'DONE'))).toBe('NOT_STARTED');
    });
  });

  describe('pace', () => {
    it('is none with nothing to teach, even when the year is half gone', () => {
      expect(paceOf(0, 50, 0)).toBe('none');
    });
    it('allows 5 points of slack, warns to 15, and is behind beyond that', () => {
      expect(paceOf(50, 50, 10)).toBe('ok');
      expect(paceOf(45, 50, 10)).toBe('ok');
      expect(paceOf(44, 50, 10)).toBe('warn');
      expect(paceOf(35, 50, 10)).toBe('warn');
      expect(paceOf(34, 50, 10)).toBe('bad');
    });
    it('ahead of the year is always on pace', () => {
      expect(paceOf(90, 20, 10)).toBe('ok');
    });
  });

  describe('trackStats', () => {
    const chapters = [ch('c1', [leaf('a', 'DONE'), leaf('b', 'DONE')]), ch('c2', [], 'TEACHING'), ch('c3', [leaf('d'), leaf('e')])];
    it('counts leaves not chapters, rounds the percentage, and points "now" at the leaf being taught', () => {
      const s = trackStats(chapters, 50);
      expect(s).toMatchObject({ leaves: 5, done: 2, teaching: 1, pct: 40, pace: 'warn', now: { chapterId: 'c2', title: 'c2' } });
    });
    it('"now" falls to the first untouched leaf when nothing is being taught, and to null when all is done', () => {
      expect(trackStats([ch('c1', [], 'DONE'), ch('c2'), ch('c3')], 10).now).toEqual({ chapterId: 'c2', title: 'c2' });
      expect(trackStats([ch('c1', [], 'DONE'), ch('c2', [leaf('x', 'DONE')])], 10).now).toBeNull();
    });
    it('an empty track is 0% with no pace and no "now"', () => {
      expect(trackStats([], 70)).toEqual({ leaves: 0, done: 0, teaching: 0, pct: 0, pace: 'none', now: null });
    });
  });

  describe('expectedPctOf', () => {
    const days = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04'];
    it('is the share of working days already gone, counting today', () => {
      expect(expectedPctOf(days, '2026-04-02')).toBe(50);
    });
    it('is 0 before the year opens and 100 after it closes', () => {
      expect(expectedPctOf(days, '2026-03-31')).toBe(0);
      expect(expectedPctOf(days, '2027-01-01')).toBe(100);
    });
    it('skips days that are not working days — a holiday moves nobody behind', () => {
      // 3 Apr dropped from the calendar: 2 of 3 days gone on 3 Apr, not 3 of 4.
      expect(expectedPctOf(['2026-04-01', '2026-04-02', '2026-04-04'], '2026-04-03')).toBe(67);
    });
    it('a year with no working days reads 0, never NaN', () => {
      expect(expectedPctOf([], '2026-04-02')).toBe(0);
    });
  });

  describe('reachPlan', () => {
    const chapters = [ch('c1', [leaf('a'), leaf('b')]), ch('c2'), ch('c3', [leaf('d')])];
    it('marks every leaf before the target done and the target teaching, in tree order', () => {
      expect(reachPlan(chapters, 'c2')).toEqual({ before: ['a', 'b'], target: 'c2' });
      expect(reachPlan(chapters, 'd')).toEqual({ before: ['a', 'b', 'c2'], target: 'd' });
    });
    it('reaching the very first leaf marks nothing done', () => {
      expect(reachPlan(chapters, 'a')).toEqual({ before: [], target: 'a' });
    });
    it('refuses a parent chapter or an unknown id', () => {
      expect(reachPlan(chapters, 'c1')).toBeNull();
      expect(reachPlan(chapters, 'zz')).toBeNull();
    });
  });
});
