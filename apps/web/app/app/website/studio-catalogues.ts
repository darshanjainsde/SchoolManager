/**
 * Compact option catalogues for the Studio's merged design controls.
 *
 * The old Branding/Theme/Design/Menu tabs each drew their own wireframe
 * thumbnails to stand in for a preview. The Studio HAS a live preview, so the
 * merged controls use plain labelled chips instead — the real thing on the
 * right is the picture, and the chips stay keyboardable and compact.
 */

export interface Opt {
  value: string;
  label: string;
  hint?: string;
}

export const HERO_LAYOUTS: Array<Opt & { slots: number }> = [
  { value: 'ILLUSTRATION', label: 'Illustrated', slots: 1, hint: 'Animated cards. Works with 0 images; one photo fills the Open Day card.' },
  { value: 'FULL_BLEED', label: 'Full canvas', slots: 1, hint: 'One wide photo fills the whole landing screen behind the headline.' },
  { value: 'SPLIT_MOSAIC', label: 'Mosaic 1+2', slots: 3, hint: 'Big photo left with the headline on it, two smaller photos stacked right.' },
  { value: 'SPLIT_EDITORIAL', label: 'Editorial split', slots: 1, hint: 'Headline on calm paper, one tall photo beside it.' },
  { value: 'COLLAGE', label: 'Collage band', slots: 4, hint: 'Centered headline over a band of 3–4 photos.' },
  { value: 'SLIDESHOW', label: 'Slideshow', slots: 5, hint: '3–5 photos slowly crossfade behind the headline.' },
  { value: 'MINIMAL', label: 'Minimal type', slots: 0, hint: 'Pure typography — no images.' },
];

export const HEADLINE_ACCENTS: Opt[] = [
  { value: 'DRAW', label: 'Hand-drawn underline', hint: 'The stroke draws itself under the name.' },
  { value: 'MARKER', label: 'Highlighter sweep', hint: 'An accent wash sweeps behind the headline.' },
  { value: 'GROW', label: 'Accent bar', hint: 'A solid bar grows in from the left.' },
  { value: 'NONE', label: 'None', hint: 'No accent under the headline.' },
];

export const HERO_ALIGN: Opt[] = [
  { value: 'LEFT', label: 'Left' },
  { value: 'CENTER', label: 'Center' },
];

export const HERO_OVERLAY: Opt[] = [
  { value: 'WASH', label: 'Paper wash — dark text' },
  { value: 'TINT', label: 'Brand tint — white text' },
  { value: 'DARK', label: 'Dark cinema — white text' },
];

export const HERO_HEIGHT: Opt[] = [
  { value: 'FULL', label: 'Full screen' },
  { value: 'COMPACT', label: 'Compact' },
];

export const NAV_STYLES: Opt[] = [
  { value: 'CLASSIC', label: 'Classic', hint: 'Logo left, links right.' },
  { value: 'CENTER', label: 'Centered crest', hint: 'Links split around a centered logo.' },
  { value: 'PILL', label: 'Floating pill', hint: 'A detached bar floating over your photo hero.' },
  { value: 'STRIP', label: 'Info strip', hint: 'Phone & email ribbon above the bar.' },
  { value: 'GHOST', label: 'Transparent', hint: 'Invisible over a photo hero, solid on scroll.' },
];

export const NAV_COLORS: Opt[] = [
  { value: 'PAPER', label: 'Paper', hint: 'Warm off-white.' },
  { value: 'WHITE', label: 'White', hint: 'Crisp white.' },
  { value: 'DARK', label: 'Dark', hint: 'Deep ink, white links.' },
  { value: 'BRAND', label: 'School colour', hint: 'Your primary colour, white links.' },
];

export const NAV_TEXT: Opt[] = [
  { value: 'AUTO', label: 'Auto', hint: 'Match the bar colour (recommended).' },
  { value: 'LIGHT', label: 'White text' },
  { value: 'DARK', label: 'Dark text' },
];

export const LOGIN_STYLES: Opt[] = [
  { value: 'LINK', label: 'Plain link', hint: 'Quietest.' },
  { value: 'OUTLINE', label: 'Outlined', hint: 'A drawn edge, easiest to find.' },
  { value: 'SOLID', label: 'Filled', hint: 'A soft filled chip.' },
];

/** Which layouts the overlay + opacity controls actually affect. */
export const OVERLAY_LAYOUTS = ['FULL_BLEED', 'SPLIT_MOSAIC', 'SLIDESHOW'];

/** Which layouts a background video can render on. */
export const VIDEO_LAYOUTS = ['FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'SLIDESHOW'];
