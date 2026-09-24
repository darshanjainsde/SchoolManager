// @vitest-environment node
//
// THE KIT'S GUARDS.
//
// `components/ui/kit.tsx` exists so four recurring defects cannot be written
// again. A primitive only helps if it is USED, though — so these guards check
// both halves: that the kit's own rules still say what they must, and that no
// screen has quietly gone back to hand-rolling the thing the kit replaced.
//
// Every one of these was verified to fail on the code that shipped the bug.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const webRoot = resolve(process.cwd());
const css = readFileSync(resolve(webRoot, 'app/sk-theme.css'), 'utf8');
const kit = readFileSync(resolve(webRoot, 'components/ui/kit.tsx'), 'utf8');

/** Strip comments — prose describing a pattern is not the pattern. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}
const screens = [...sourceFiles(resolve(webRoot, 'app')), ...sourceFiles(resolve(webRoot, 'components'))]
  .filter((f) => !f.endsWith('components/ui/kit.tsx'));

/** The declaration block whose selector LIST contains `sel`. */
const rule = (sel: string) => {
  const esc = sel.replace(/[.[\]"=>()*+?^$|\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return code(css).match(new RegExp(`[^{}]*${esc}[^{}]*\\{[^}]*\\}`))?.[0] ?? '';
};

describe('rows line up because the LIST owns the columns', () => {
  it('a row takes its tracks from the list, never from itself', () => {
    // The defect: `.sk-row` is flex with a `flex: 1` spacer, so every row's
    // trailing controls land wherever that row's text ends. Screenshotted
    // twice — a pay list and a settings list, both visibly ragged.
    const r = rule('.sk-rowline');
    expect(r, '.sk-rowline has no rule').toBeTruthy();
    expect(r).toMatch(/display:\s*grid/);
    expect(r, 'a row must inherit the list\u2019s tracks, or rows cannot agree').toMatch(/grid-template-columns:\s*var\(--sk-row-cols/);
  });

  it('a cell may shrink, so one long name cannot widen the page', () => {
    expect(rule('.sk-rowcell')).toMatch(/min-width:\s*0/);
  });

  it('the name and its subtitle are block, whatever element a caller used', () => {
    // `.sk-row .nm`/`.meta` set only font and colour and relied on <div>;
    // borrowed onto a <span> they ran together — "Aarav MehtaTeacher".
    for (const sel of ['.sk-rowtitle', '.sk-rowsub']) {
      expect(rule(sel), `${sel} inherits its display from the caller`).toMatch(/display:\s*block/);
    }
  });

  it('a right-aligned cell goes back to the left when the row stacks', () => {
    const phone = code(css).slice(code(css).indexOf('@media (max-width: 560px)'));
    expect(phone).toMatch(/\.sk-rowcell\[data-align="end"\][^}]*text-align:\s*left/);
  });
});

describe('a field cannot overflow its track, and its hint is not its name', () => {
  it('the control is border-box, because the shared input class is not', () => {
    const r = rule('.sk-field > .sk-input');
    expect(r).toMatch(/box-sizing:\s*border-box/);
    expect(r).toMatch(/width:\s*100%/);
  });

  it('the hint is wired through aria-describedby, never nested in the label', () => {
    expect(kit).toMatch(/aria-describedby/);
    // The label holds the label text and nothing else.
    expect(kit).toMatch(/<label className="sk-lab" htmlFor=\{id\}>\{label\}<\/label>/);
  });

  it('invalid is announced, not only coloured', () => {
    expect(kit).toMatch(/'aria-invalid'/);
  });
});

describe('figures meant to be compared stay one row, in one unit', () => {
  it('uses fixed columns, never auto-fit', () => {
    // auto-fit at any sensible floor strands the third tile on its own row at
    // 390px — the layout looks broken exactly where a family reads it.
    const r = rule('.sk-figures[data-count="3"]');
    expect(r).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(r).not.toMatch(/auto-fit/);
  });

  it('the figure shrinks instead of wrapping', () => {
    expect(rule('.sk-figure .v')).toMatch(/clamp\(/);
  });
});

describe('an overlay keeps the theme, the viewport and its action bar', () => {
  it('portals into a .skosx wrapper at the shared z-layer', () => {
    // Inline, `.sk-anim`'s transform re-anchors `position: fixed`. On bare
    // <body>, every --sk-* token resolves to nothing — it shipped see-through.
    expect(kit).toMatch(/createPortal\(/);
    expect(kit).toMatch(/className="skosx sk-scrim"/);
    expect(kit).toMatch(/zIndex:\s*Z\.OVERLAY/);
  });

  it('traps focus and locks the page behind it', () => {
    expect(kit).toMatch(/useFocusTrap\(panel, onClose\)/);
    expect(kit).toMatch(/document\.body\.style\.overflow = 'hidden'/);
  });

  it('the BODY scrolls, not the panel — so the action bar cannot scroll away', () => {
    expect(rule('.sk-panel')).toMatch(/overflow:\s*hidden/);
    const body = rule('.sk-panel-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body, 'a flex child needs min-height:0 before it will scroll').toMatch(/min-height:\s*0/);
    expect(rule('.sk-panel-actions'), 'the action bar must not be in the scroller').toMatch(/flex:\s*none/);
  });

  it('its entrance has no fill mode, so a frozen first frame is never off-screen', () => {
    // With `both`, the panel holds the off-screen `from` frame until the first
    // animation tick — and a throttled tab never ticks.
    expect(rule('.sk-panel')).toMatch(/animation:\s*sk-panel-in\s+[\d.]+s\s+ease-out;/);
  });
});

describe('no screen has gone back to hand-rolling what the kit provides', () => {
  it('no new overlay is built outside the kit', () => {
    // Three overlays predate the kit and are grandfathered; a fourth must use
    // it. This is the guard that would have stopped the see-through drawer.
    const allowed = [
      'components/ui/dialog-shell.tsx',
      'components/press/order-drawer.tsx',
      'components/press/print-room.tsx',
      'components/press/press-print-portal.tsx',
      'components/fees/record-payment-dialog.tsx',
      'components/public/sections/ConnectSection.tsx',
      'components/public/sections/GallerySection.tsx',
      'components/marketing/CallbackModal.tsx',
      'components/MobileNavDrawer.tsx',
      'components/teacher/ConfirmDialog.tsx',
      'app/app/fees/setup/page.tsx',
      'app/app/pay/drawer.tsx',
      // The console dock's own popover, which predates the kit.
      'app/app/dock.tsx',
    ];
    const offenders = screens
      .filter((f) => code(readFileSync(f, 'utf8')).includes('createPortal'))
      .map((f) => f.slice(webRoot.length + 1))
      .filter((f) => !allowed.includes(f));
    expect(
      offenders,
      'These render their own portal. Use `Overlay` from components/ui/kit.tsx, or add the file here with a reason:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('the kit itself never uses the flex row it exists to replace', () => {
    expect(code(kit)).not.toMatch(/className="sk-row[ "]/);
  });

  it('every animation it names actually exists', () => {
    // Deleting a block took its @keyframes with it and left one rule still
    // naming it. An undefined animation-name is not an error — the element
    // simply never animates, which is invisible until someone watches for it.
    const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
    const used = [...code(css).matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== 'none');
    const missing = [...new Set(used)].filter((n) => !defined.has(n));
    expect(missing, `animation-name with no @keyframes: ${missing.join(', ')}`).toEqual([]);
  });
});
