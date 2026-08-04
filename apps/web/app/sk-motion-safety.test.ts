import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * THE INVISIBLE-CONTENT GUARD.
 *
 * The entrance gestures start from `opacity: 0` — that is what makes them
 * entrances. `.sk-pinin` and `.sk-stampin` only ever become visible when the
 * `sk-in` class is also present, because that is the selector carrying the
 * animation:
 *
 *     .sk-pinin           { opacity: 0; … }
 *     .sk-pinin.sk-in     { animation: sk-pinin … both; }
 *
 * So a element that gets `sk-pinin` WITHOUT `sk-in` renders, occupies space,
 * satisfies every `getByText`/`getByRole` query in every test we have — and is
 * permanently invisible to an actual human. No component test can catch that,
 * because jsdom does not run animations and Testing Library does not care
 * about opacity. This file is the net.
 *
 * It also pins the reduced-motion contract. `prefers-reduced-motion: reduce`
 * MUST collapse these classes to their END state (`opacity: 1`), never to
 * `animation: none` — switching the animation off while the base class still
 * says `opacity: 0` is the classic reduced-motion regression, and it fails
 * exactly for the users least able to work around it.
 */

const WEB_ROOT = path.join(__dirname, '..');
const THEME = path.join(__dirname, 'sk-theme.css');

/** Entrance classes whose base state is invisible. */
const NEEDS_SK_IN = ['sk-pinin', 'sk-stampin'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Pulls the class list out of every `className="…"` / `className={'…'}` /
 * template-literal className in a file. Deliberately regex-based rather than a
 * real parser: this only has to be good enough to spot a missing partner class
 * on the same attribute, and every real usage in this codebase writes the two
 * together as literal text.
 */
function classAttributes(src: string): string[] {
  const out: string[] = [];
  const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out;
}

describe('motion safety — an entrance gesture can never hide content', () => {
  const files = sourceFiles(path.join(WEB_ROOT, 'app')).concat(
    sourceFiles(path.join(WEB_ROOT, 'components')),
  );

  it('found source files to scan (the scan is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(NEEDS_SK_IN)('every `%s` element also carries `sk-in`', (cls) => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes(cls)) continue;
      for (const attr of classAttributes(src)) {
        // Pull out identifier-shaped tokens rather than splitting on
        // whitespace: a className is routinely a template literal with a
        // ternary inside (`sk-notice${up ? ' sk-pinin sk-in' : ''}`), and a
        // naive split leaves quotes stuck to the token — which made this very
        // guard report a correct usage as a violation the first time it ran.
        const classes: string[] = attr.match(/[A-Za-z0-9_-]+/g) ?? [];
        if (classes.includes(cls) && !classes.includes('sk-in')) {
          offenders.push(`${path.relative(WEB_ROOT, file)} → className="${attr}"`);
        }
      }
    }
    expect(
      offenders,
      `\`${cls}\` sets opacity:0 and only animates in when \`sk-in\` is present. ` +
        'Without it the element renders, passes every query, and is invisible to a human:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('reduced motion collapses the entrance gestures to their END state, not to "no animation"', () => {
    const css = fs.readFileSync(THEME, 'utf8');
    const block = css.slice(css.indexOf('Collapse to the END state'));
    expect(block).toBeTruthy();

    // The pin/stamp override must restore BOTH opacity and transform — an
    // `animation: none` alone would leave the base `opacity: 0` in force.
    const pinStamp = block.slice(0, block.indexOf('}') + 1);
    expect(pinStamp).toMatch(/opacity:\s*1/);
    expect(pinStamp).toMatch(/transform:\s*none/);

    // The stroke-drawn gestures must land at a zero dash offset, or the tick
    // and the signature stay unwritten.
    expect(block).toMatch(/stroke-dashoffset:\s*0/);
  });

  it('the base classes really are invisible — so the guard above is load-bearing', () => {
    const css = fs.readFileSync(THEME, 'utf8');
    // If someone later removes `opacity: 0` from these, the guard stops being
    // necessary — and this assertion is what tells them to delete it rather
    // than leaving a test that quietly protects nothing.
    for (const cls of NEEDS_SK_IN) {
      const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*opacity:\\s*0`);
      expect(css, `.${cls} no longer starts invisible — re-check whether this guard is still needed`).toMatch(rule);
    }
  });
});
