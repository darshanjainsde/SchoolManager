// @vitest-environment node
//
// EVERY SECTION FRONT PAGE IS THE SAME ROOM.
//
// Fees, Reports & Documents and Print Store drifted three ways at once and
// the owner had to point at all three: boxed to 1024px with a gap either side,
// the subtitle beside the title instead of under it, doors wrapping 3 + 1,
// and nothing after them. None of it is visible to typecheck or to a render
// test that asserts on words. This reads the source and fails on the drift.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'app/app');

/** The hubs: a section's index page, built on components/ui/hub.tsx. */
const HUBS = ['fees/page.tsx', 'press/page.tsx', 'press/orders/page.tsx', 'onboarding/page.tsx'];
/** Pay's front page is a tab inside PayShell (which owns the header), so it uses the rows, not HubPage. */
const HUB_TABS = ['pay/home-tab.tsx'];

/** Whole trees whose pages were boxed and are not any more. */
const TREES = ['fees', 'press'];

function tsxUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxUnder(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('every hub is built on the shared pattern', () => {
  it.each(HUBS)('%s uses HubPage, with the subtitle under the title and no box of its own', (rel) => {
    const src = read(rel);
    expect(src, 'imports the hub kit').toMatch(/from '@\/components\/ui\/hub'/);
    expect(src, 'renders <HubPage').toMatch(/<HubPage\b/);
    expect(src, 'the header is HubPage’s, not a hand-written sk-pagehead').not.toMatch(/className="sk-pagehead/);
    expect(src, 'no 1024px box').not.toMatch(/\bmax-w-(3|4|5|6|7)xl\b/);
    expect(src, 'no mx-auto wrapper').not.toMatch(/className="mx-auto/);
  });

  it.each(HUBS)('%s has the three rows: numbers, doors, a live list', (rel) => {
    const src = read(rel);
    expect(src, 'numbers').toMatch(/<HubKpis>/);
    expect(src, 'a live list').toMatch(/<HubList\b|<RowList\b/);
    // Onboarding’s "doors" are its three working sheets; every other hub has a doors row.
    if (!rel.startsWith('onboarding')) expect(src, 'doors').toMatch(/<HubDoors>/);
  });

  it.each(HUB_TABS)('%s (a tab under a shell) still uses the doors and the list rows', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '@\/components\/ui\/hub'/);
    expect(src).toMatch(/<HubDoors>/);
    expect(src).toMatch(/<HubList\b/);
  });
});

describe('no page under a hub is boxed any more', () => {
  const pages = TREES.flatMap((t) => tsxUnder(resolve(ROOT, t))).map((f) => relative(ROOT, f));
  it('finds the pages at all', () => {
    expect(pages.length).toBeGreaterThanOrEqual(12);
  });
  it.each(pages)('%s has no mx-auto max-w-Nxl wrapper', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/mx-auto[^"]*\bmax-w-(3|4|5|6|7)xl\b|\bmax-w-(3|4|5|6|7)xl\b[^"]*mx-auto/);
  });
});

describe('the hub kit itself', () => {
  const kit = readFileSync(resolve(process.cwd(), 'components/ui/hub.tsx'), 'utf8');
  it('puts the subtitle in the same column as the title, under it', () => {
    // One wrapper holds h1 and p; the action is a sibling of that wrapper.
    expect(kit).toMatch(/<div className="sk-hubtitle">\s*<h1>\{title\}<\/h1>\s*<p>\{subtitle\}<\/p>\s*<\/div>/);
  });
  it('draws the doors with the 260px floor that clears a door’s text on a wide monitor', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
    expect(css).toMatch(/\.sk-hubdoors \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 260px\), 1fr\)\); \}/);
  });
  it('writes a door’s name and meta as blocks, so they cannot run together on one line', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');
    expect(css).toMatch(/\.sk-hubdoor \.nm, \.sk-hubdoor \.meta \{ display: block; \}/);
  });
  it('builds the list on RowList, so every row shares one set of column tracks', () => {
    expect(kit).toMatch(/<RowList columns=\{columns\}/);
  });
});
