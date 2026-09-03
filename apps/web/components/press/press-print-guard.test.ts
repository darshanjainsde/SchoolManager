// @vitest-environment node
//
// Print-discipline guard for the Press, enforcing three rules the sales
// booklet and the Exam Hall already paid for:
//
//   1. NO box-shadow anywhere near a printed sheet — Chrome's print-to-PDF
//      flattens a blurred shadow into a solid grey slab. This cost a whole
//      booklet print run before it became a rule.
//   2. NO theme tokens (var(--sk-…)) inside the sheet components — a sheet is
//      paper in both themes, and a dark-mode browser must not print
//      white-on-black. Literal ink only.
//   3. `id="press-print"` exists ONLY in the portal component. The print CSS
//      shows the container with `body.press-printing > #press-print`, a
//      direct-child selector — an inline container nested in the app tree
//      would be hidden with its ancestors and the job prints blank.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Comments are blanked before scanning — the sheets DOCUMENT the box-shadow
 * rule in prose, and a guard that fires on prose about itself is one people
 * learn to ignore (the tenant-aggregates guard learned this first).
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*(?:\/\/|\*).*$/gm, ' ');
}

const SHEETS = code(readFileSync(join(process.cwd(), 'components/press/press-sheets.tsx'), 'utf8'));
const CSS = code(readFileSync(join(process.cwd(), 'components/press/press-print.css'), 'utf8'));

/** Every file that participates in press printing, found not hand-listed. */
function pressSources(): { path: string; src: string }[] {
  const roots = ['components/press', 'app/app/press', 'app/portal/results/report-card', 'app/app/exam-hall', 'app/app/students', 'app/platform/orders'];
  const out: { path: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) {
        out.push({ path: full, src: code(readFileSync(full, 'utf8')) });
      }
    }
  };
  for (const r of roots) walk(join(process.cwd(), r));
  return out;
}

describe('press print discipline', () => {
  it('found the press sources at all', () => {
    // A sweep that silently matches nothing passes forever.
    expect(pressSources().length).toBeGreaterThan(5);
  });

  it('never uses box-shadow in anything that prints', () => {
    expect(SHEETS).not.toMatch(/box-?shadow/i);
    // The screen-only preview chrome may not shadow either — it shares the
    // stylesheet with the print path and the cost of the rule is zero.
    expect(CSS).not.toMatch(/box-shadow/i);
  });

  it('keeps the sheets on literal ink, never theme tokens', () => {
    expect(SHEETS).not.toContain('var(--sk-');
  });

  it('mounts print containers only through the body portal', () => {
    // Applies to the Press AND the Exam Hall: an inline id="press-print" /
    // id="eh-print" nested in the app tree prints blank pages (reproduced
    // with the real print.css in headless Chrome before this rule existed).
    // The container id on a raw DOM element is the bug; the same id passed
    // as a prop to BodyPrintPortal is the sanctioned path.
    const inlineContainer = /<(?:div|section|main)[^>]*id="(?:press-print|eh-print)"/;
    const offenders = pressSources()
      .filter((f) => !f.path.endsWith('press-print-portal.tsx') && !f.path.endsWith('.css'))
      .filter((f) => inlineContainer.test(f.src))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
