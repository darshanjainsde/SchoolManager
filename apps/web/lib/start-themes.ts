/**
 * Complete "start from a theme" presets — the ready-made themes a school picks
 * as a starting point and then customises. Unlike the old colour-only presets,
 * each one carries the WHOLE design: colours, font, animation, the first
 * screen, section styling, the navbar and the footer.
 *
 * Every field is one the Studio already renders and the API already validates
 * (see UpdateProfileDto's @IsIn lists), so applying a theme is just a
 * many-field setLook — data, not new plumbing, and nothing is locked
 * afterwards. Only the 7 standard themes live here; the premium (parallax /
 * kinetic / scrollytelling) themes wait for the motion modules so they stay
 * truthful.
 *
 * The values here MUST stay within those allow-lists or a publish would 400 —
 * keep them in step with cms.dto.ts and site-variants.ts.
 */

import type { SectionVariants } from '@/components/public/site-variants';

export interface FooterCfg {
  layout: 'COLUMNS' | 'SIMPLE' | 'CENTER';
  color: 'PAPER' | 'DARK' | 'BRAND';
  social: boolean;
  contact: boolean;
  tagline: string | null;
  twoCols: boolean;
}

export interface ThemeConfig {
  brandColorPrimary: string;
  brandColorSecondary: string;
  headingFont: 'INTER' | 'FRAUNCES' | 'POPPINS' | 'NUNITO' | 'PLAYFAIR' | 'LORA' | 'MONTSERRAT' | 'SPACE_GROTESK';
  animationLevel: 'LIVELY' | 'FULL' | 'BALANCED' | 'SUBTLE' | 'MINIMAL' | 'NONE';
  heroLayout: 'ILLUSTRATION' | 'FULL_BLEED' | 'SPLIT_MOSAIC' | 'SPLIT_EDITORIAL' | 'COLLAGE' | 'SLIDESHOW' | 'MINIMAL';
  heroTextAlign: 'LEFT' | 'CENTER';
  heroOverlayStyle: 'WASH' | 'TINT' | 'DARK';
  heroOverlayOpacity: number;
  heroHeight: 'FULL' | 'COMPACT';
  headlineAccent: 'DRAW' | 'MARKER' | 'GROW' | 'NONE';
  sectionShape: 'SOFT' | 'EDITORIAL' | 'CRISP';
  motionGesture: 'RISE' | 'FADE' | 'DRAW';
  backgroundTexture: 'NONE' | 'GRID' | 'DOTS' | 'PAPER';
  scrollFeel: 'CLASSIC' | 'GLIDE' | 'SNAP' | 'DECK';
  navStyle: 'CLASSIC' | 'CENTER' | 'PILL' | 'STRIP' | 'GHOST';
  navColor: 'PAPER' | 'WHITE' | 'DARK' | 'BRAND';
  navTextColor: 'AUTO' | 'LIGHT' | 'DARK';
  navLoginStyle: 'LINK' | 'OUTLINE' | 'SOLID';
  footerConfig: FooterCfg;
  /**
   * Per-band layout choices that give each theme its own treatment — most
   * visibly the stats band (rings / odometer / bars / big numerals / strip).
   * Values are validated by normalizeSectionVariants, so an unknown one is
   * silently ignored rather than shipped.
   */
  sectionVariants: SectionVariants;
}

export interface StartTheme {
  id: string;
  name: string;
  /** Who it suits, shown as a subtitle. */
  audience: string;
  /** One line describing the look. */
  blurb: string;
  config: ThemeConfig;
}

/** The signature scalar fields used to detect "you started from this theme". */
export const THEME_MATCH_KEYS: (keyof ThemeConfig)[] = [
  'brandColorPrimary', 'brandColorSecondary', 'headingFont', 'heroLayout',
  'sectionShape', 'backgroundTexture', 'navStyle', 'navColor',
];

const footer = (layout: FooterCfg['layout'], color: FooterCfg['color'], extra: Partial<FooterCfg> = {}): FooterCfg => ({
  layout, color, social: true, contact: true, tagline: null, twoCols: false, ...extra,
});

export const START_THEMES: StartTheme[] = [
  {
    id: 'heritage',
    name: 'Heritage',
    audience: 'Established & senior schools',
    blurb: 'Serif, ruled columns and a calm two-tone — reads like a printed prospectus.',
    config: {
      brandColorPrimary: '#1f4d3a', brandColorSecondary: '#c9a227', headingFont: 'FRAUNCES', animationLevel: 'SUBTLE',
      heroLayout: 'SPLIT_EDITORIAL', heroTextAlign: 'LEFT', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65, heroHeight: 'COMPACT', headlineAccent: 'DRAW',
      sectionShape: 'EDITORIAL', motionGesture: 'FADE', backgroundTexture: 'PAPER', scrollFeel: 'CLASSIC',
      navStyle: 'CLASSIC', navColor: 'PAPER', navTextColor: 'AUTO', navLoginStyle: 'OUTLINE',
      footerConfig: footer('COLUMNS', 'DARK'),
      sectionVariants: { stats: { layout: 'STRIP' }, about: { layout: 'OVERLAP' } },
    },
  },
  {
    id: 'metro',
    name: 'Metro',
    audience: 'STEM & international schools',
    blurb: 'Bold indigo, a full-canvas photo hero and crisp cards on a faint grid.',
    config: {
      brandColorPrimary: '#3b4ee0', brandColorSecondary: '#38bdf8', headingFont: 'POPPINS', animationLevel: 'FULL',
      heroLayout: 'FULL_BLEED', heroTextAlign: 'LEFT', heroOverlayStyle: 'DARK', heroOverlayOpacity: 68, heroHeight: 'FULL', headlineAccent: 'GROW',
      sectionShape: 'CRISP', motionGesture: 'RISE', backgroundTexture: 'GRID', scrollFeel: 'GLIDE',
      navStyle: 'PILL', navColor: 'WHITE', navTextColor: 'AUTO', navLoginStyle: 'SOLID',
      footerConfig: footer('COLUMNS', 'DARK'),
      sectionVariants: { stats: { layout: 'RINGS' }, courses: { layout: 'CAROUSEL' }, gallery: { layout: 'MASONRY' } },
    },
  },
  {
    id: 'bright-start',
    name: 'Bright Start',
    audience: 'Preschool & primary',
    blurb: 'Warm coral & teal, rounded type and the friendly animated-cards hero.',
    config: {
      brandColorPrimary: '#f2653f', brandColorSecondary: '#12b3a6', headingFont: 'NUNITO', animationLevel: 'FULL',
      heroLayout: 'ILLUSTRATION', heroTextAlign: 'LEFT', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65, heroHeight: 'FULL', headlineAccent: 'MARKER',
      sectionShape: 'SOFT', motionGesture: 'RISE', backgroundTexture: 'DOTS', scrollFeel: 'CLASSIC',
      navStyle: 'CENTER', navColor: 'PAPER', navTextColor: 'AUTO', navLoginStyle: 'LINK',
      footerConfig: footer('CENTER', 'BRAND'),
      sectionVariants: { courses: { layout: 'CAROUSEL' } },
    },
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    audience: 'Classical & liberal-arts schools',
    blurb: 'A literary, newspaper register — centered masthead, serif type, quiet motion.',
    config: {
      brandColorPrimary: '#17171a', brandColorSecondary: '#b3402f', headingFont: 'FRAUNCES', animationLevel: 'SUBTLE',
      heroLayout: 'MINIMAL', heroTextAlign: 'CENTER', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65, heroHeight: 'COMPACT', headlineAccent: 'NONE',
      sectionShape: 'EDITORIAL', motionGesture: 'FADE', backgroundTexture: 'NONE', scrollFeel: 'CLASSIC',
      navStyle: 'CENTER', navColor: 'PAPER', navTextColor: 'AUTO', navLoginStyle: 'LINK',
      footerConfig: footer('COLUMNS', 'PAPER', { twoCols: true }),
      sectionVariants: { stats: { layout: 'STRIP' }, about: { layout: 'CENTER' } },
    },
  },
  {
    id: 'horizon',
    name: 'Horizon',
    audience: 'Design-led & selective schools',
    blurb: 'Swiss restraint — oversized type, one electric accent, lots of white space.',
    config: {
      brandColorPrimary: '#15171c', brandColorSecondary: '#4f7bff', headingFont: 'INTER', animationLevel: 'SUBTLE',
      heroLayout: 'MINIMAL', heroTextAlign: 'LEFT', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65, heroHeight: 'FULL', headlineAccent: 'GROW',
      sectionShape: 'CRISP', motionGesture: 'RISE', backgroundTexture: 'NONE', scrollFeel: 'CLASSIC',
      navStyle: 'CLASSIC', navColor: 'WHITE', navTextColor: 'AUTO', navLoginStyle: 'LINK',
      footerConfig: footer('SIMPLE', 'PAPER'),
      sectionVariants: { stats: { layout: 'BIGNUM' }, gallery: { layout: 'MASONRY' } },
    },
  },
  {
    id: 'campus',
    name: 'Campus',
    audience: 'Boarding & photo-forward schools',
    blurb: 'Photography leads — a slideshow hero behind a transparent bar, dark footer.',
    config: {
      brandColorPrimary: '#22303a', brandColorSecondary: '#e8a33d', headingFont: 'INTER', animationLevel: 'FULL',
      heroLayout: 'SLIDESHOW', heroTextAlign: 'LEFT', heroOverlayStyle: 'DARK', heroOverlayOpacity: 70, heroHeight: 'FULL', headlineAccent: 'NONE',
      sectionShape: 'CRISP', motionGesture: 'RISE', backgroundTexture: 'NONE', scrollFeel: 'SNAP',
      navStyle: 'GHOST', navColor: 'DARK', navTextColor: 'LIGHT', navLoginStyle: 'SOLID',
      footerConfig: footer('SIMPLE', 'DARK'),
      sectionVariants: { stats: { layout: 'ODOMETER' }, gallery: { layout: 'FILMSTRIP' }, admissions: { layout: 'TILES' } },
    },
  },
  {
    id: 'terra',
    name: 'Terra',
    audience: 'Montessori, forest & holistic schools',
    blurb: 'Earthy terracotta & sage, soft organic cards and a photo collage.',
    config: {
      brandColorPrimary: '#b4552f', brandColorSecondary: '#6b8e5a', headingFont: 'POPPINS', animationLevel: 'FULL',
      heroLayout: 'COLLAGE', heroTextAlign: 'CENTER', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65, heroHeight: 'FULL', headlineAccent: 'GROW',
      sectionShape: 'SOFT', motionGesture: 'RISE', backgroundTexture: 'PAPER', scrollFeel: 'CLASSIC',
      navStyle: 'CLASSIC', navColor: 'BRAND', navTextColor: 'LIGHT', navLoginStyle: 'LINK',
      footerConfig: footer('CENTER', 'BRAND'),
      sectionVariants: { stats: { layout: 'BARS' }, about: { layout: 'CENTER' }, gallery: { layout: 'MASONRY' } },
    },
  },
];

/** Whether the current look was started from this theme (signature fields match). */
export function themeInUse(theme: StartTheme, look: Record<string, unknown>): boolean {
  return THEME_MATCH_KEYS.every((k) => String(look[k] ?? '') === String(theme.config[k]));
}
