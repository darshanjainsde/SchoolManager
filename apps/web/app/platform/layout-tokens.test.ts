// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layout = readFileSync(resolve(process.cwd(), 'app/platform/layout.tsx'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

describe('the owner console can actually see the theme', () => {
  it('declares its palette inside .skosx, which is what makes the class load-bearing', () => {
    // If this ever stops being true the guard below is measuring nothing.
    const block = css.slice(css.indexOf('.skosx {'), css.indexOf('}', css.indexOf('.skosx {')));
    expect(block).toContain('--sk-line:');
    expect(block).toContain('--sk-ink:');
  });

  it('puts skosx on the element that wraps the pages', () => {
    // Shipped without it once. Every --sk-* token then resolves to nothing,
    // CSS drops each declaration that references one, and the desk renders as
    // bare text — no border, no card, no pill fill, and no error to find.
    const main = layout.match(/<main[\s\S]*?>/);
    expect(main).not.toBeNull();
    expect(main![0]).toContain('skosx');
  });

  it('imports the stylesheet in the shell, not page by page', () => {
    expect(layout).toContain("import '../sk-theme.css'");
  });

  it('gives the page area its own padding, so headings do not sit on the rail', () => {
    const main = layout.match(/<main[\s\S]*?\/>|<main[\s\S]*?>[\s\S]*?<\/main>/);
    expect(main![0]).toMatch(/padding/);
  });
});
