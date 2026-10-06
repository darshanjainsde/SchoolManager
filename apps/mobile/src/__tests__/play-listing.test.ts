import * as fs from 'fs';
import * as path from 'path';

/**
 * The Google Play listing, checked against the app it describes.
 *
 * 2 Oct 2026: the first production release was rejected (Misleading Claims).
 * The reviewer note told Google to "enter the school code raffles" on a screen
 * deleted two months earlier, so the reviewer never signed in and every
 * feature in the description looked missing. The description also sold
 * web-only features. These files live in docs/play-listing; see its README.
 */
const REPO = path.resolve(__dirname, '../../../..');
const LISTING = path.join(REPO, 'docs/play-listing');
const APP = path.join(REPO, 'apps/mobile/src/app');
const read = (f: string) => fs.readFileSync(path.join(LISTING, f), 'utf8').replace(/\s+$/, '');
const LOGIN = fs.readFileSync(path.join(APP, '(auth)/login.tsx'), 'utf8');

describe('Play listing limits', () => {
  it.each([
    ['short-description.txt', 80],
    ['full-description.txt', 4000],
    ['reviewer-note-teacher.txt', 500],
    ['reviewer-note-family.txt', 500],
    ['release-notes.txt', 500],
  ])('%s fits Play\'s %i-character limit', (file, limit) => {
    const text = read(file);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(limit);
  });
});

describe('reviewer notes match the sign-in screen the reviewer will see', () => {
  it.each(['reviewer-note-teacher.txt', 'reviewer-note-family.txt'])('%s quotes only labels the app has', (file) => {
    const quoted = [...read(file).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(0);
    // "Parent / student" names the other Play Console entry, not an app label.
    const labels = quoted.filter((q) => q !== 'Parent / student');
    for (const label of labels) expect({ label, inLoginScreen: LOGIN.includes(label) }).toEqual({ label, inLoginScreen: true });
  });

  it.each(['reviewer-note-teacher.txt', 'reviewer-note-family.txt'])('%s never asks for a school code (that screen was removed)', (file) => {
    expect(read(file)).not.toMatch(/enter (the|a|your) school code/i);
    expect(LOGIN).not.toMatch(/label="School code"/);
  });

  it('never contains a password', () => {
    for (const f of fs.readdirSync(LISTING)) expect(fs.readFileSync(path.join(LISTING, f), 'utf8')).not.toMatch(/password\s*[:=]\s*\S/i);
  });
});

describe('the description claims only what the app does', () => {
  // Each claim in full-description.txt → the screen that delivers it.
  const CLAIMS: [RegExp, string][] = [
    [/Attendance —/, '(family)/(tabs)/attendance.tsx'],
    [/Diary —/, '(family)/(tabs)/home/diary.tsx'],
    [/Homework —/, '(family)/(tabs)/home/assignments.tsx'],
    [/marks/, '(family)/(tabs)/results.tsx'],
    [/Timetable —/, '(family)/(tabs)/home/timetable.tsx'],
    [/holiday calendar/, '(family)/(tabs)/home/holidays.tsx'],
    [/school notices/, '(family)/(tabs)/home/notices.tsx'],
    [/Fees —/, '(family)/(tabs)/fees.tsx'],
    [/Messages —/, '(family)/(tabs)/home/messages.tsx'],
    [/books you borrowed/, '(family)/(tabs)/home/library.tsx'],
    [/your sports house/, '(family)/(tabs)/home/sports.tsx'],
    [/Complaint box —/, '(family)/(tabs)/home/concerns.tsx'],
    [/More than one child/, '(family)/(tabs)/home/shelf.tsx'],
    [/Take attendance for your class/, '(staff)/take/[classSectionId].tsx'],
    [/periods for the day/, '(staff)/(tabs)/timetable.tsx'],
    [/class diary/, '(staff)/(tabs)/home/diary.tsx'],
    [/set homework/, '(staff)/(tabs)/home/assignments.tsx'],
    [/enter marks/, '(staff)/(tabs)/home/tests.tsx'],
    [/Post notices/, '(staff)/(tabs)/home/post.tsx'],
    [/messages from parents/, '(staff)/(tabs)/home/messages.tsx'],
    [/Apply for leave/, '(staff)/(tabs)/home/requests.tsx'],
  ];
  const full = read('full-description.txt');

  it.each(CLAIMS.map(([re, file]) => [re.source, file]))('"%s" is backed by %s', (src, file) => {
    expect(full).toMatch(new RegExp(src));
    expect(fs.existsSync(path.join(APP, file))).toBe(true);
  });

  it('claims nothing the two reviewer logins cannot open (staff desks need a staff login)', () => {
    for (const desk of [/library counter/i, /sports desk/i, /pay ?slips?/i, /payroll/i]) expect(full).not.toMatch(desk);
  });

  it('names no feature that only the website or admin console has', () => {
    for (const web of [/website/i, /admissions/i, /staff management/i, /operating system/i, /enquir/i, /timetable builder/i])
      expect(full).not.toMatch(web);
  });

  it('every bullet in the description is covered by a claim above', () => {
    const bullets = full.split('\n').filter((l) => l.startsWith('•'));
    const uncovered = bullets.filter((b) => !CLAIMS.some(([re]) => re.test(b)));
    expect(uncovered).toEqual([]);
  });
});
