import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A PAGE NOBODY CAN REACH IS A PAGE THAT DOES NOT EXIST.
 *
 * The jobs board shipped on sckools.com with nothing linking to it and no nav
 * of its own — reachable only by typing the URL, and a dead end once you got
 * there. These pin both halves: the marketing site points at /jobs, and the
 * jobs pages carry the marketing nav so there is a way back.
 */
const marketing = readFileSync(join(__dirname, 'MarketingSite.tsx'), 'utf8');
const board = readFileSync(join(__dirname, '../../app/jobs/page.tsx'), 'utf8');
const vacancy = readFileSync(join(__dirname, '../../app/jobs/[id]/page.tsx'), 'utf8');

describe('the jobs board is reachable', () => {
  it('is in the marketing navbar', () => {
    const nav = marketing.slice(marketing.indexOf('MNAV_LINKS'), marketing.indexOf('MnavLink'));
    expect(nav).toContain("href: '/jobs'");
  });

  it('is in the marketing footer too', () => {
    // A route must be a <Link>: next lint refuses a bare <a> to an app page.
    expect(marketing).toMatch(/<Link href="\/jobs">Jobs<\/Link>/);
  });

  it.each([
    ['the board', () => board],
    ['a vacancy', () => vacancy],
  ])('%s carries the marketing nav rather than being a dead end', (_n, read) => {
    expect(read()).toContain('PlatformBlogNav');
  });
});
