import { describe, it, expect } from 'vitest';
import { SECTION_SHAPES, sectionShapeClass } from './section-shape';

/**
 * THE CONTROL THAT FIXES THE DISTRIBUTION PROBLEM.
 *
 * Schools were never short of customisation — seven hero layouts, five nav
 * styles, two brand colours, a heading font. The problem is WHERE it all lands:
 * almost every control applies to the first screen. Below the fold, every
 * school in the network renders the same page with two colours swapped.
 *
 * Section shape is one control that applies to everything below the fold at
 * once, which is why it goes first. It is a TOKEN change — a class on the root
 * that redefines radius, border, shadow and padding — never a per-school
 * template, because per-school templates do not survive at network scale.
 */
describe('choosing a shape', () => {
  it('offers exactly the three the admin can pick', () => {
    expect(SECTION_SHAPES.map((s) => s.value)).toEqual(['SOFT', 'EDITORIAL', 'CRISP']);
  });

  it('gives each one a root class the stylesheet can hang tokens off', () => {
    expect(sectionShapeClass('EDITORIAL')).toBe('ps-shape-editorial');
    expect(sectionShapeClass('CRISP')).toBe('ps-shape-crisp');
  });

  it('adds no class for SOFT, because SOFT is what the base tokens already say', () => {
    // Every existing school renders SOFT today. If picking the default added a
    // class, the column's arrival would repaint the whole network.
    expect(sectionShapeClass('SOFT')).toBe('');
  });

  it('falls back to SOFT for a value it does not recognise, not to a blank page', () => {
    // An older api that has never heard of the column sends undefined; a newer
    // one could send a shape this build predates.
    expect(sectionShapeClass(undefined)).toBe('');
    expect(sectionShapeClass('BRUTALIST')).toBe('');
  });

  it('describes each shape in words an admin can choose between', () => {
    for (const shape of SECTION_SHAPES) {
      expect(shape.label.length).toBeGreaterThan(0);
      // The hint has to say what CHANGES, not how it feels — "rounded cards
      // with soft shadows" is choosable, "friendly and warm" is not.
      expect(shape.hint.length).toBeGreaterThan(10);
    }
  });
});
