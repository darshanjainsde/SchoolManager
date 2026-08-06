/**
 * How a school's page is SHAPED below the fold.
 *
 * Schools were never short of customisation — the first screen alone has seven
 * hero layouts, five nav styles, an accent motif and two brand colours. The
 * problem is distribution: almost all of it lands above the fold, so every
 * school's page below it is the same page with two colours swapped.
 *
 * This is one control that reaches everything below the fold at once. It is
 * deliberately a TOKEN change — a class on the root that redefines radius,
 * border, shadow, background and band padding — never a per-school template.
 * Templates do not survive at network scale; tokens do.
 *
 * No component or font imports here: the nav model's test learned the hard way
 * that a test reaching into a component module drags `next/font` with it.
 */
export interface SectionShape {
  value: 'SOFT' | 'EDITORIAL' | 'CRISP';
  label: string;
  /** What CHANGES, in words an admin can choose between — not how it feels. */
  hint: string;
}

export const SECTION_SHAPES: SectionShape[] = [
  {
    value: 'SOFT',
    label: 'Soft',
    hint: 'Rounded cards that float on the page, with soft shadows and roomy spacing.',
  },
  {
    value: 'EDITORIAL',
    label: 'Editorial',
    hint: 'No cards at all. Entries sit in ruled columns like a printed prospectus.',
  },
  {
    value: 'CRISP',
    label: 'Crisp',
    hint: 'Square-ish cards with a drawn border, no shadow, and tighter spacing.',
  },
];

/**
 * SOFT deliberately returns no class: it is what the base tokens already say,
 * and every school in the network renders it today. If the default added a
 * class, shipping the column would repaint every existing site.
 */
export function sectionShapeClass(shape: string | null | undefined): string {
  switch (shape) {
    case 'EDITORIAL':
      return 'ps-shape-editorial';
    case 'CRISP':
      return 'ps-shape-crisp';
    default:
      return '';
  }
}
