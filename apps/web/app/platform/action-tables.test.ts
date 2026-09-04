// @vitest-environment node
//
// In a .sk-tbl every <td> is `white-space: nowrap` and the wrapper is
// `overflow: auto`. That combination is fine until one cell has no natural
// ceiling — a joined list, a long URL — at which point the table grows wider
// than its card and scrolls sideways. The first thing pushed out of view is
// the right-most column, which is always `acts`: the only column that DOES
// anything.
//
// This shipped on /platform/schools. A PRO school listed eleven feature keys
// on one unbreakable line, so Status and Manage sat off the right edge at any
// window width, and the page read as a static report rather than a console.
// Nothing caught it: it type-checks, it lints, and it looks correct in any
// screenshot narrow enough to have short data.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return tsxUnder(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

const ROOT = resolve(process.cwd(), 'app/platform');

/** Every <td …>…</td> block in the source, crudely but sufficiently. */
function cells(src: string): string[] {
  return src.split('<td').slice(1).map((chunk) => chunk.split('</td>')[0]);
}

const actionTables = tsxUnder(ROOT).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return src.includes('sk-tbl') && src.includes('className="acts"');
});

describe('tables that carry an actions column', () => {
  it('has tables to check', () => {
    expect(actionTables.length).toBeGreaterThan(0);
  });

  it('never lets an unbounded cell push the actions off screen', () => {
    const offenders: string[] = [];
    for (const file of actionTables) {
      const src = readFileSync(file, 'utf8');
      for (const cell of cells(src)) {
        // A cell that renders a joined list has no width ceiling. It must
        // either truncate (stays one line, ellipsis) or wrap (grows taller,
        // never wider). Doing neither widens the table without limit.
        const unbounded = /\.join\(/.test(cell);
        const bounded = cell.includes('data-truncate') || cell.includes('data-wrap');
        if (unbounded && !bounded) {
          offenders.push(`${relative(process.cwd(), file)}: ${cell.trim().slice(0, 70)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
