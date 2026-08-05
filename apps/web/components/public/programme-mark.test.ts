import { describe, it, expect } from 'vitest';
import { programmeMark } from './programme-mark';

/**
 * A PROGRAMME IS NOT A TEDDY BEAR.
 *
 * Every programme without uploaded artwork — which is most of them, on most
 * schools — rendered as a 48px emoji from a fixed list of eight, cycled by
 * array index. So "Senior School (Class 9–12)" got 🎨 because it happened to be
 * fifth, and two schools with four programmes each showed the identical four
 * pictures. It is the single most visible piece of sameness below the fold.
 *
 * The replacement is a mark generated from the programme's own initial and the
 * school's own palette. It must be DETERMINISTIC: these render on the server
 * and again in the browser, and anything the server cannot reproduce is a
 * hydration mismatch that React 19 discards in silence.
 */
describe('the generated programme mark', () => {
  it('takes the programme’s own initial', () => {
    expect(programmeMark('Preschool (Nursery–UKG)').initial).toBe('P');
    expect(programmeMark('senior school').initial).toBe('S');
  });

  it('skips over punctuation and digits to the first real letter', () => {
    // "(Class 9–12) Senior" and "2026 Intake" must not show "(" or "2".
    expect(programmeMark('(Class 9–12) Senior').initial).toBe('C');
    expect(programmeMark('2026 Intake').initial).toBe('I');
  });

  it('falls back to a neutral mark rather than rendering an empty box', () => {
    expect(programmeMark('').initial).toBe('•');
    expect(programmeMark('   ').initial).toBe('•');
    expect(programmeMark('12345').initial).toBe('•');
  });

  it('gives the same programme the same mark every time', () => {
    // Not decoration: the server and the browser must agree, or the subtree is
    // thrown away silently on hydration.
    const a = programmeMark('Primary School (Class 1–5)');
    const b = programmeMark('Primary School (Class 1–5)');
    expect(a).toEqual(b);
  });

  it('varies between programmes, so four of them are not one picture repeated', () => {
    const names = ['Preschool', 'Primary School', 'Middle School', 'Senior School'];
    const tints = names.map((n) => programmeMark(n).tint);
    expect(new Set(tints).size).toBeGreaterThan(1);
  });

  it('stays inside the school’s own two colours', () => {
    // The mark mixes --ps1 and --ps2; it never introduces a third hue, or a
    // school's page grows colours its brand does not have.
    for (const name of ['Preschool', 'Primary', 'Middle', 'Senior', 'Sixth Form']) {
      const { tint } = programmeMark(name);
      expect(tint).toBeGreaterThanOrEqual(0);
      expect(tint).toBeLessThanOrEqual(100);
    }
  });

  it('does not depend on the position in the list', () => {
    // The emoji bug was index-driven: reorder the programmes and every picture
    // moved. The mark belongs to the programme, not to its row.
    expect(programmeMark('Senior School')).toEqual(programmeMark('Senior School'));
  });
});
