/**
 * The rest of the customisation increment, alongside [[section-shape]].
 *
 * Section shape fixed WHERE a school's page differs — everything below the
 * fold rather than just the first screen. These fix WHAT differs: the gesture
 * a section makes as it arrives, the ground it sits on, and whether the
 * school's headline motif is allowed off the headline.
 *
 * Same rule throughout: the DEFAULT emits no class. The defaults are what every
 * existing school already renders, so shipping these columns repaints nobody.
 *
 * No component or font imports — this module is read by tests and by the admin
 * console, and reaching into a component would drag next/font into both.
 */

export interface StyleOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

/**
 * WHAT a section does as it arrives — a separate axis from `animationLevel`,
 * which remains the volume knob. Folding them together would take the off
 * switch away from a school that asked for stillness: NONE still silences the
 * whole page, whichever gesture is chosen.
 */
export type MotionGesture = 'RISE' | 'FADE' | 'DRAW';
export const MOTION_GESTURES: StyleOption<MotionGesture>[] = [
  { value: 'RISE', label: 'Rise', hint: 'Sections lift into place from just below. The current default.' },
  { value: 'FADE', label: 'Fade', hint: 'Sections appear without moving — the calmest of the three.' },
  { value: 'DRAW', label: 'Draw', hint: 'Sections are uncovered left to right, like ink crossing the page.' },
];

export type BackgroundTexture = 'NONE' | 'GRID' | 'DOTS' | 'PAPER';
export const BACKGROUND_TEXTURES: StyleOption<BackgroundTexture>[] = [
  { value: 'NONE', label: 'Plain', hint: 'Flat paper, the way the site looks today.' },
  { value: 'GRID', label: 'Grid', hint: 'A faint ruled grid, like squared exercise-book paper.' },
  { value: 'DOTS', label: 'Dots', hint: 'A fine dot field, quieter than a grid and a little softer.' },
  { value: 'PAPER', label: 'Paper', hint: 'A soft mottled wash, closest to printed stock.' },
];

/** RISE and NONE are the base stylesheet; only the others need a class. */
export function motionGestureClass(gesture: string | null | undefined): string {
  return gesture === 'FADE' ? 'ps-gesture-fade' : gesture === 'DRAW' ? 'ps-gesture-draw' : '';
}

export function backgroundTextureClass(texture: string | null | undefined): string {
  switch (texture) {
    case 'GRID':
      return 'ps-texture-grid';
    case 'DOTS':
      return 'ps-texture-dots';
    case 'PAPER':
      return 'ps-texture-paper';
    default:
      return '';
  }
}

/**
 * The motif escaping the headline.
 *
 * Reuses the school's existing `headlineAccent` rather than adding a second
 * control: two settings that could disagree about one motif is how a page
 * stops looking like one page. `GROW` maps to a distinct class because the
 * hero already owns `.ps-accent-grow`.
 */
export function accentClass(accent: string | null | undefined): string {
  switch (accent) {
    case 'DRAW':
      return 'ps-accent-draw';
    case 'MARKER':
      return 'ps-accent-marker';
    case 'GROW':
      return 'ps-accent-grow-on';
    default:
      return '';
  }
}

export interface StylePreset {
  value: string;
  label: string;
  hint: string;
  values: {
    sectionShape: string;
    motionGesture: MotionGesture;
    backgroundTexture: BackgroundTexture;
    headlineAccent: string;
  };
}

/**
 * Six looks, assembled.
 *
 * Most admins will not build a coherent page out of four dropdowns — not
 * because they lack taste but because the combinations that work together are
 * not obvious from the controls. A preset sets every axis at once, so applying
 * one can never leave a half-changed page.
 *
 * The first is the current default on purpose: a list where nothing matches
 * what a school is already wearing tells them their own look is not on the menu.
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    value: 'CLASSIC',
    label: 'Classic',
    hint: 'Soft cards on plain paper — warm and familiar. What your site wears now.',
    values: { sectionShape: 'SOFT', motionGesture: 'RISE', backgroundTexture: 'NONE', headlineAccent: 'DRAW' },
  },
  {
    value: 'PROSPECTUS',
    label: 'Prospectus',
    hint: 'Ruled columns on printed stock. Reads like the booklet you hand parents at the gate.',
    values: { sectionShape: 'EDITORIAL', motionGesture: 'FADE', backgroundTexture: 'PAPER', headlineAccent: 'MARKER' },
  },
  {
    value: 'STUDIO',
    label: 'Studio',
    hint: 'Bordered cards on a faint grid. Precise and modern, good for a school leading on STEM.',
    values: { sectionShape: 'CRISP', motionGesture: 'RISE', backgroundTexture: 'GRID', headlineAccent: 'GROW' },
  },
  {
    value: 'PLAYGROUND',
    label: 'Playground',
    hint: 'Soft cards on a dot field with a highlighter motif. Suits early years and primary.',
    values: { sectionShape: 'SOFT', motionGesture: 'RISE', backgroundTexture: 'DOTS', headlineAccent: 'MARKER' },
  },
  {
    value: 'BROADSHEET',
    label: 'Broadsheet',
    hint: 'Boxless and unhurried, uncovered as you scroll. For a school with a lot to say in words.',
    values: { sectionShape: 'EDITORIAL', motionGesture: 'DRAW', backgroundTexture: 'NONE', headlineAccent: 'DRAW' },
  },
  {
    value: 'INSTITUTE',
    label: 'Institute',
    hint: 'Bordered, still and unadorned. The most formal — senior schools and exam boards.',
    values: { sectionShape: 'CRISP', motionGesture: 'FADE', backgroundTexture: 'NONE', headlineAccent: 'NONE' },
  },
];
