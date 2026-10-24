// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'components/earn/earn.css'), 'utf8');

/**
 * The /earn hero's three promise cards. A descendant `.earn-promise div` rule
 * styled the inner text block as well as the card, so production drew a card
 * inside each card and put the title BESIDE its line ("We do / the / selling"
 * in a narrow column). 24 Oct 2026, reported from sckools.com/earn.
 */
describe('the /earn promise cards', () => {
  it('styles only the direct child as the card, never every div inside it', () => {
    expect(css).not.toMatch(/\.earn-promise\s+div\s*\{/);
    expect(css).toMatch(/\.earn-promise\s*>\s*div\s*\{[^}]*border:/);
  });

  it('stacks the title above its line inside the card', () => {
    const inner = /\.earn-promise\s*>\s*div\s*>\s*div\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(inner).toMatch(/flex-direction:\s*column/);
    expect(inner).toMatch(/min-width:\s*0/);
    expect(inner).not.toMatch(/border|box-shadow/);
  });
});
