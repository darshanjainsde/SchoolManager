// @vitest-environment node
//
// The sports wing is the widest thing in the console — a timetable of courts,
// a bracket of rounds, a grid of days — and every one of those has to survive
// a 390px phone by scrolling inside its own box rather than widening the page.
//
// These are the traps that actually shipped here, each now mechanical:
//
//   · .sk-input carried padding and a border but no box-sizing, so every
//     `width: 100%` use overflowed its track by exactly its own padding. It was
//     patched locally in three separate rules before being fixed at the source.
//   · The day picker let its <select> size itself to its longest option, which
//     pushed both stepper arrows onto lines of their own.
//   · A wide thing without its own overflow container widens the whole page.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const web = resolve(process.cwd());
const css = readFileSync(resolve(web, 'app/sk-theme.css'), 'utf8');
/** Prose describing a pattern is not the pattern. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

function tsx(dir: string): string[] {
  return readdirSync(resolve(web, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.'))
    .map((e) => join(dir, e.name));
}
const sportsFiles = [...tsx('app/app/sports'), ...tsx('components/sports')];

describe('the shared input can be made full width safely', () => {
  it('.sk-input is border-box, so width:100% never overflows its track', () => {
    const base = rules.find((r) => r.sel === '.sk-input');
    expect(base).toBeDefined();
    expect(base!.body).toMatch(/box-sizing:\s*border-box/);
  });

  it('no control is stretched to 100% while its own padding hangs outside the box', () => {
    // Only padding and a border can overflow. A bare `width: 100%` on a control
    // that has neither (a range slider, an input with `border: 0`) is fine.
    const pads = (b: string) => /padding[^;]*:\s*(?!0\b)[^;]+/.test(b) || /border(?!-box)[^;]*:\s*(?!0\b)[^;]*\d+px/.test(b);
    const offenders = rules
      .filter((r) => /width:\s*100%/.test(r.body) && /(^|\s|,)(input|select|textarea)(\s|,|:|\[|$)/.test(r.sel))
      .filter((r) => pads(r.body) && !/box-sizing:\s*border-box/.test(r.body))
      .map((r) => r.sel);
    expect(offenders).toEqual([]);
  });
});

describe('the day picker survives its own longest option', () => {
  const pick = rules.find((r) => r.sel === '.sk-sp-daypick');

  it('keeps the stepper, the list and the stepper on one row', () => {
    expect(pick?.body).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('lets the list shrink instead of pushing the arrows off the line', () => {
    const field = rules.find((r) => r.sel === '.sk-sp-daypick .sk-sp-field');
    expect(field?.body).toMatch(/min-width:\s*0/);
    const input = rules.find((r) => r.sel === '.sk-sp-daypick .sk-input');
    expect(input?.body).toMatch(/min-width:\s*0/);
  });
});

describe('every wide thing scrolls inside its own box', () => {
  // A timetable of courts, a bracket of rounds and a grid of days are all
  // wider than a phone by nature. Each must carry its own scroller.
  it.each(['.sk-sp-tt', '.sk-sp-bracket', '.sk-sp-plangrid'])('%s has overflow-x', (sel) => {
    const r = rules.find((x) => x.sel === sel);
    expect(r, `${sel} is missing`).toBeDefined();
    expect(r!.body).toMatch(/overflow-x:\s*auto|overflow:\s*auto/);
  });

  it('every table in the sports wing sits in a scrolling wrapper', () => {
    const bad: string[] = [];
    for (const f of sportsFiles) {
      const src = readFileSync(resolve(web, f), 'utf8');
      for (const m of src.matchAll(/<table/g)) {
        if (!src.slice(Math.max(0, m.index! - 400), m.index!).includes('sk-tblwrap')) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('nothing in the sports wing is pinned to a width a phone does not have', () => {
  it('no sports rule sets a fixed width past what 390px can hold', () => {
    const offenders = rules
      .filter((r) => r.sel.includes('sk-sp-'))
      .flatMap((r) => [...r.body.matchAll(/(?<![a-z-])width:\s*(\d{3,})px/g)].map((m) => `${r.sel} → ${m[0]}`))
      .filter((line) => Number(/(\d{3,})px/.exec(line)![1]) > 330);
    expect(offenders).toEqual([]);
  });

  it('no sports component hard-codes a pixel width inline', () => {
    const bad: string[] = [];
    for (const f of sportsFiles) {
      const src = readFileSync(resolve(web, f), 'utf8');
      for (const m of src.matchAll(/(?:width|minWidth):\s*(\d{3,})(?!\d)/g)) bad.push(`${f} → ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
