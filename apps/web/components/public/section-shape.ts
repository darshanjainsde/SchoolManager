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
  value: 'SOFT' | 'EDITORIAL' | 'CRISP' | 'PANELS' | 'SLANT' | 'NOTCH' | 'WAVE';
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
  {
    value: 'PANELS',
    label: 'Panels',
    hint: 'Every section becomes its own wide rounded panel floating on a tinted page — the whole page reshapes, not just the cards inside it.',
  },
  {
    value: 'SLANT',
    label: 'Slant',
    hint: 'Panels with diagonally-cut tops on a tinted page — the sections meet at angled edges instead of flat lines.',
  },
  {
    value: 'NOTCH',
    label: 'Notch',
    hint: 'Panels with a chevron notch cut into the top edge — a precise, architectural detail between sections.',
  },
  {
    value: 'WAVE',
    label: 'Wave',
    hint: 'Panels with a soft wavy top edge on a tinted page — friendly and organic, good for younger schools.',
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
    case 'PANELS':
      return 'ps-shape-panels';
    case 'SLANT':
      return 'ps-shape-panels ps-edge-slant';
    case 'NOTCH':
      return 'ps-shape-panels ps-edge-notch';
    case 'WAVE':
      return 'ps-shape-panels ps-edge-wave';
    default:
      return '';
  }
}
