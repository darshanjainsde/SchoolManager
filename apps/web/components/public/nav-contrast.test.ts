import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SIGN-IN MUST NOT DISAPPEAR INTO THE BAR.
 *
 * The dark-bar rule was scoped to `nav`, and the actions — Login and the CTA —
 * sit OUTSIDE the <nav> element. So on a dark or brand bar every menu link went
 * white while Login alone kept the default slate, reading as a disabled
 * control. It was never a colour a school configured badly; it was a selector
 * that did not reach.
 */
const CSS = readFileSync(join(__dirname, 'ps-css.ts'), 'utf8');

describe('the dark-bar ink reaches the actions', () => {
  it('colours .ps-nav-link itself, not only links inside <nav>', () => {
    expect(CSS).toMatch(/\.ps-nav-ondark[^{]*\.ps-nav-link[^{]*\{[^}]*color:/);
  });
});

describe('the login styles cannot be configured into invisibility', () => {
  it('draws both from currentColor, so they follow whatever the bar did to the text', () => {
    const outline = CSS.slice(CSS.indexOf('.ps-login-outline'), CSS.indexOf('.ps-login-outline') + 200);
    const solid = CSS.slice(CSS.indexOf('.ps-login-solid'), CSS.indexOf('.ps-login-solid') + 200);
    expect(outline).toContain('currentColor');
    expect(solid).toContain('currentColor');
  });

  it('never spends the accent on sign-in — that belongs to the one primary action', () => {
    const solid = CSS.slice(CSS.indexOf('.ps-login-solid'), CSS.indexOf('.ps-login-solid') + 200);
    expect(solid).not.toContain('--ps2');
  });
});
