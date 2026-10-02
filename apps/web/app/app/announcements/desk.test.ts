// @vitest-environment node
//
// WHAT THE ANNOUNCEMENTS DESK MAY NOT GO BACK TO.
//
// The page it replaced was a hand-rolled Tailwind table with the message cut
// to one line, a compose card rendered IN FLOW above the list, and a red
// Delete on every row with no confirmation — on rows that are things already
// sent to families. None of that is visible to a typecheck or to a render
// test that asserts on words, so this reads the source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = read('app/app/announcements/page.tsx');
const css = read('app/sk-theme.css');
const api = read('../api/src/modules/management/announcements.service.ts');

describe('the desk is built from the kit', () => {
  it('uses the shared row list, so the columns belong to the LIST and cannot go ragged', () => {
    expect(page).toMatch(/from '@\/components\/ui\/kit'/);
    expect(page).toMatch(/<RowList\b/);
    expect(page).toMatch(/<Row\b/);
    expect(page).toMatch(/<Cell\b/);
  });

  it('has no table of its own', () => {
    expect(page, 'the hand-rolled Tailwind table is gone').not.toMatch(/from '@\/components\/ui\/table'/);
    expect(page).not.toMatch(/<THead\b|<TBody\b|<Tr\b/);
  });

  it('writes and deletes in an Overlay, never in flow under the list', () => {
    // An editor rendered after a list opens off-screen at the real row count —
    // the ledger has this three times. The composer is a portalled drawer.
    expect(page).toMatch(/<Overlay\b/);
    expect(page, 'the inline card is gone').not.toMatch(/showAdd/);
  });

  it('asks before deleting, and says what delete cannot undo', () => {
    expect(page).toMatch(/kind: 'delete'/);
    expect(page).toMatch(/cannot be\s*\n?\s*taken back|cannot be taken back/);
  });
});

describe('the list tells the truth at the real numbers', () => {
  it('groups the rows into notices, because one post to N classes is N rows', () => {
    expect(page).toMatch(/groupNotices\(/);
  });

  it('shows a slice and says how many more, rather than a year of posts', () => {
    expect(page).toMatch(/<ShowMore\b/);
  });

  it('keeps what is on screen when a load fails, and offers the retry', () => {
    // Blanking to the empty state would say "nothing was ever posted", which is
    // a different and much worse sentence than "this did not load".
    expect(page).toMatch(/list\.error &&/);
    expect(page).toMatch(/refetch\(\)/);
    expect(page).toMatch(/notices\.length === 0/);
  });
});

describe('the audience says WHICH class', () => {
  it('the API sends the grade with the section, so a pill can never read just "B"', () => {
    // Scoped to list() on purpose: mine() has always included the grade, so a
    // whole-file match passed even with list()'s include reverted — proved by
    // breaking it and watching this test stay green.
    const start = api.indexOf('async list(schoolId: string)');
    const body = api.slice(start, api.indexOf('async mine(', start));
    expect(start, 'list() still exists').toBeGreaterThan(0);
    expect(body).toMatch(/grade: \{ select: \{ name: true \} \}/);
  });
});

describe('the stylesheet carries the rules the page depends on', () => {
  it('a pill in a row cell hugs its words instead of stretching the track', () => {
    expect(css).toMatch(/\.sk-rowcell:not\(\[data-align="end"\]\) > \.sk-pill \{ justify-self: start; \}/);
  });

  it('the message is clamped to two lines, with the display the clamp needs', () => {
    expect(css).toMatch(/\.sk-annbody \{[^}]*-webkit-line-clamp: 2/);
    expect(css).toMatch(/\.sk-annbody \{[^}]*display: -webkit-box/);
  });

  it('the notice keeps the blank lines it was written with', () => {
    expect(css).toMatch(/\.sk-annread \{[^}]*white-space: pre-wrap/);
  });

  it('the grade chip does not wear the chosen look', () => {
    // `data-strong` is the same indigo as `aria-pressed`, so an admin could not
    // tell which grades they had actually picked.
    expect(page).not.toMatch(/data-strong/);
    expect(css).toMatch(/\.sk-annpick \.g > \.sk-chip \{[^}]*font-weight: 800/);
  });
});
