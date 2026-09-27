// @vitest-environment node
//
// THE THREE SHELL RULES EVERY PORTAL DEPENDS ON.
//
// The owner reported the teacher portal as "very non professional": the
// subtitle beside the title instead of under it, a row of figures stopping
// short of the card below it, and a band of dead space down the right of every
// tab. None of the three belonged to a screen — they were three rules in the
// shared stylesheet, which is why they showed up on every tab at once and on
// other portals too.
//
// Measured in a browser against the REAL components (audit/shells.test.tsx +
// audit/measure.html): with the old rules, 14 findings at 1440px; with these,
// clean at 360 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920.
//
// This file is the fast guard that runs in CI, where no browser does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Comments out, before anything is matched.
 *
 * Every rule below is documented with a comment naming the exact thing it
 * forbids — "max-width", "repeat(4, 1fr)". A guard that greps the raw file
 * therefore fails on the commit that fixes the bug, and the obvious way to
 * make it pass is to delete the explanation. That is backwards, so the
 * comments come out first.
 */
const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(i, css.indexOf('}', i) + 1);
};

describe('the page head', () => {
  const head = rule('.sk-pagehead > h1 + p');

  it('caps the subtitle with padding, never max-width', () => {
    // max-width is the trap: a flex line breaks on the flex-basis CLAMPED BY
    // max-width, so a 64ch cap shrank this item to 544px — narrow enough to
    // sit beside a short title — and `flex-basis: 100%` never got to break the
    // line. Padding leaves the BOX full width and shortens only the text.
    expect(head).toMatch(/flex:\s*1 0 100%/);
    expect(head).toMatch(/padding-right:\s*max\(0px,\s*calc\(100% - 64ch\)\)/);
    expect(head).not.toMatch(/max-width/);
  });
});

describe('a row of figures', () => {
  it('fills its row at two, three or four tiles', () => {
    // Four columns were hard-coded above 900px, so three figures left the
    // fourth track empty and the row stopped a quarter short of the card under
    // it. Measured with the old rule: two tiles stopped 530px short, three
    // stopped 265px short. auto-fit collapses the tracks nobody fills.
    const wide = css.slice(css.indexOf('@media (min-width: 900px) { .sk-kpis'));
    const decl = wide.slice(0, wide.indexOf('}') + 1);
    expect(decl).toMatch(/auto-fit/);
    expect(decl).not.toMatch(/repeat\(4,\s*1fr\)/);
  });
});

describe('a form label', () => {
  it('owns its line, on a <label> as much as on a <p>', () => {
    // `.sk-lab` sets font and colour and no display, so it inherited the
    // element's own: block on the <p> and <div> that use it, inline on the 62
    // <label>s. Beside a bare inline-block control the pair shared a line and
    // the label centred against the field — the family's "Raise a concern"
    // form as the owner photographed it. Scoped to `label` because the 150
    // <span class="sk-lab"> uses are chips inside flex rows and are correct.
    expect(css).toMatch(/label\.sk-lab \{[^}]*display:\s*block/);
  });

  it('leaves the span form of the class alone', () => {
    expect(css).not.toMatch(/^\.sk-lab \{[^}]*display:/m);
  });
});

describe('the family concern form', () => {
  it('is a column whose controls all fill it', () => {
    // They were 138px, 166px and 178px inside a 1,047px card — three boxes
    // sized to their own content, which reads as three unrelated fields.
    const form = rule('.sk-conraise {');
    expect(form).toMatch(/max-width:\s*34rem/);
    expect(css).toMatch(/\.sk-conraise \.sk-input \{[^}]*width:\s*100%/);
  });
});

describe('the content column', () => {
  const content = rule('.sk-content {');

  it('is centred, not pinned to one side', () => {
    // A `flex: 1` item with a max-width grows to the cap and stops, so all the
    // slack lands on one side: measured at a 1600px window, 236px of dead
    // space on the right of the teacher portal and none on the left.
    expect(content).toMatch(/margin-inline:\s*auto/);
  });

  it('is the same column the other portals use', () => {
    // `.sk-main` (staff, family portal) was already 68rem and centred. Two
    // shells disagreeing about the width is what makes moving between them
    // feel unfinished.
    expect(content).toMatch(/max-width:\s*68rem/);
    expect(rule('.sk-main {')).toMatch(/max-width:\s*68rem/);
  });
});

describe("the diary's month grid", () => {
  it('takes a definite width, so it fills its card instead of shrinking to its content', () => {
    // The card body is a flex column. `max-width` with `margin-inline: auto`
    // makes a flex item shrink-wrap: measured, the grid went from 338px to
    // 218px at every width and each square from 39px to 26px — under the size
    // a finger can hit, while the CSS still read as correct.
    expect(css).toMatch(/\.sk-dcal \.sk-cal \{[^}]*width:\s*min\(100%,\s*420px\)/);
    expect(css).not.toMatch(/\.sk-dcal \.sk-cal \{[^}]*max-width/);
  });

  it('gives a square its own meaning, separate from attendance', () => {
    // Same grid and square as the attendance calendar — one calendar language
    // for a family that reads both — but its own states, because a diary day
    // holds a count of things, not one status.
    for (const state of ['items', 'remark', 'none', 'off', 'future']) {
      expect(css).toMatch(new RegExp(`\\.sk-cell\\[data-diary="${state}"\\]`));
    }
    // Closed days carry no border: "the school was shut" must not look like
    // "nothing written yet".
    expect(rule('.sk-cell[data-diary="off"]')).toMatch(/border-color:\s*transparent/);
  });

  it('keeps the month arrows big enough for a thumb', () => {
    const arrow = rule('.sk-dcal-arrow {');
    expect(arrow).toMatch(/width:\s*36px/);
    expect(arrow).toMatch(/height:\s*36px/);
  });
});

describe('the standalone desks sit in that column too', () => {
  for (const f of ['app/library/layout.tsx', 'app/sports/layout.tsx']) {
    it(`${f} caps and centres its content`, () => {
      // Both ran edge to edge, so a counter form filled a 2000px monitor while
      // the teacher portal next door sat in a centred column.
      expect(readFileSync(resolve(process.cwd(), f), 'utf8')).toMatch(/mx-auto w-full max-w-\[68rem\]/);
    });
  }
});
