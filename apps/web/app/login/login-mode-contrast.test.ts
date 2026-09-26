// @vitest-environment node
//
// THE SIGN-IN SWITCH MUST READ ON THE PANEL IT SITS ON.
//
// "Mobile number" / "Email & password" sit on the white form half (.gh-right
// is #fff). The first version coloured the unselected label
// rgba(255,255,255,.72) — a white label on a white panel — so whichever door
// was not chosen was invisible, and the owner asked where the other option
// had gone. No render test sees a colour; this reads the stylesheet.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio } from '@/components/public/site-utils';

const css = readFileSync(resolve(process.cwd(), 'app/login/login.css'), 'utf8');
const rule = (sel: string) => {
  const m = css.match(new RegExp(sel.replace(/[.[\]'*]/g, (c) => '\\' + c) + '\\s*\\{([^}]*)\\}'));
  if (!m) throw new Error('rule not found: ' + sel);
  return m[1];
};
const prop = (block: string, name: string) => block.match(new RegExp('(?:^|;)\\s*' + name + ':\\s*([^;]+)'))?.[1].trim() ?? null;

/** rgba(r,g,b,a) over white → the hex a reader actually sees. */
function overWhite(color: string): string {
  const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return color;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const ch = (v: string) => Math.round(Number(v) * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return '#' + ch(m[1]) + ch(m[2]) + ch(m[3]);
}

describe('the sign-in method switch', () => {
  it('sits on a white panel', () => {
    expect(prop(rule('.gh-right'), 'background')).toBe('#fff');
  });
  it('the unselected label reads on white — at least 4.5:1, never a white', () => {
    const color = prop(rule('.gh-mode'), 'color')!;
    expect(color).not.toMatch(/rgba\(\s*255,\s*255,\s*255/);
    expect(contrastRatio(overWhite(color), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('the selected label is the school colour on a white pill with an edge, so it reads on the grey track', () => {
    const on = rule(".gh-mode[aria-checked='true']");
    expect(prop(on, 'background')).toBe('#fff');
    expect(prop(on, 'color')).toMatch(/var\(--gh-p/);
    expect(prop(on, 'box-shadow')).toMatch(/0 0 0 1px/);
  });
  it('the track itself is a grey, not a white glow', () => {
    expect(prop(rule('.gh-modes'), 'background')).not.toMatch(/rgba\(\s*255,\s*255,\s*255/);
  });
});
