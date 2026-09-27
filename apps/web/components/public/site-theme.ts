import type { CSSProperties } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { isNearWhite, labelOn, lighten, mix, textSafe } from './site-utils';
import { fontVars, FONT_STACK } from '@/lib/fonts';
import { sectionShapeClass } from './section-shape';
import { accentClass, backgroundTextureClass, motionGestureClass } from './site-style';
import {
  festiveClasses,
  festivalDef,
  navDropdownAnimClass,
  normalizeFestiveTheme,
  scrollFeelClass,
} from './site-variants';

// The animation "volume knob": every keyframe and reveal in the stylesheet is
// written as `calc(x * var(--motion))`, so one scalar dials the whole page.
// NONE (0) additionally adds ps-motion-off, which hard-stops the ambient loops.
// LIVELY (>1) amplifies within safe bounds (translations/rotations grow ~30%,
// durations shorten); it stays under the point where any motion inverts.
const MOTION_MAP: Record<string, number> = {
  LIVELY: 1.3,
  FULL: 1,
  BALANCED: 0.75,
  SUBTLE: 0.5,
  MINIMAL: 0.35,
  NONE: 0,
};

/**
 * Everything that makes a page LOOK like a particular school: the class list
 * and the CSS variables the whole stylesheet reads.
 *
 * Extracted so that every surface wearing a school's identity computes it the
 * same way. The blog used to render outside this entirely — its own bare
 * topbar, no palette, no fonts — so a school's blog looked like nobody's blog.
 * Duplicating the computation to fix that would have guaranteed the two drift
 * apart; there is one definition, and both call it.
 */
export function themeRootProps(data: PublicSiteData): { className: string; style: CSSProperties } {
  const brandColor = data.profile?.brandColorPrimary ?? '#2f6b4f';
  const rawSecondary = data.profile?.brandColorSecondary ?? '#e8b04b';
  // A school that left the secondary near-white gets a lightened primary
  // instead: two near-identical stops make every gradient look broken.
  const brandColor2 = isNearWhite(rawSecondary) ? lighten(brandColor, 0.4) : rawSecondary;
  const fontHead = FONT_STACK[data.profile?.headingFont ?? 'INTER'] ?? FONT_STACK.INTER;
  const motion = MOTION_MAP[data.profile?.animationLevel ?? 'FULL'] ?? 1;

  const declaredLayout =
    data.profile?.heroLayout ??
    (data.profile?.heroStyle === 'PHOTO' ? 'FULL_BLEED' : (data.profile?.heroStyle ?? 'ILLUSTRATION'));
  const minimal = declaredLayout === 'MINIMAL';

  // Festive overlay. LAYER only swaps the accent (when the school kept
  // recolor on); FULL retints the brand stops, and a night festival also
  // takes the paper and ink dark. All resolved HERE because these are the
  // inline variables the whole stylesheet reads — a class alone cannot beat
  // an inline style.
  const fest = normalizeFestiveTheme(data.profile?.festiveTheme);
  const festDef = fest ? festivalDef(fest.festival) : null;
  const treatment = fest && festDef ? fest.treatment : null;
  let ps1 = brandColor;
  let ps2 = brandColor2;
  let paper = '#f7f5ef';
  // ── The two surfaces, as tokens ──
  // Text below the fold is written in Tailwind's slate utilities, and the
  // stylesheet remaps those utilities to these tokens inside .ps-root (see
  // "two surfaces" in ps-css.css). With no festival on, every token below IS
  // the slate value the utility always had, so nothing repaints — and a
  // treatment changes the page by changing six numbers here, not by finding
  // a hundred class names.
  let panel = '#ffffff';
  let textStrong = '#1e293b'; // slate-800
  let textBody = '#475569';   // slate-600
  // slate-500 on the site's cream measures 4.37:1 — under AA on every page,
  // festival or not, since the site shipped. Walked to the first shade that
  // clears 4.5 (a hair darker, same hue) rather than jumped to slate-600.
  let textMuted = textSafe('#64748b', '#f7f5ef');
  let textFaint = '#94a3b8';  // slate-400
  let ink = mix(brandColor, '#14261d', 0.55);
  if (fest && festDef) {
    if (treatment === 'NIGHT') {
      ps1 = festDef.full.ps1;
      ps2 = festDef.full.ps2;
      const night = festDef.fullSurface ?? { paper: mix(festDef.full.ps1, '#0d0b10', 0.86), ink: '#f3ecdc' };
      paper = night.paper;
      ink = night.ink;
      panel = mix(paper, '#ffffff', 0.08);
      textStrong = ink;
      // Tints of the ink, then walked back toward it until they read: the
      // ratio is the contract, the tint is only the starting point.
      textBody = textSafe(mix(ink, paper, 0.18), panel, 5);
      textMuted = textSafe(mix(ink, paper, 0.28), panel, 4.5);
      textFaint = mix(ink, paper, 0.45);
    } else if (treatment === 'WASH') {
      ps1 = festDef.full.ps1;
      ps2 = festDef.full.ps2;
      paper = mix('#f7f5ef', festDef.full.ps2, 0.16);
      ink = mix(festDef.full.ps1, '#14261d', 0.7);
      panel = mix(paper, '#ffffff', 0.7);
      textStrong = mix(ink, '#000000', 0.1);
      textBody = textSafe(mix(ink, paper, 0.25), paper, 5);
      textMuted = textSafe(mix(ink, paper, 0.4), paper, 4.5);
      textFaint = mix(ink, paper, 0.58);
    } else if (treatment === 'LAYER' && fest.recolor) {
      ps2 = festDef.accent;
    } else if (treatment === 'HERO') {
      // The first screen carries the festival; the page below is the
      // school's, so only the accent moves — and only where it is a fill.
      ps2 = festDef.accent;
    }
  }
  const festDark = treatment === 'NIGHT';
  // Accents that have to be READ (eyebrows, links, figures) are derived, not
  // chosen: the festival's colour walked toward black or white until it
  // clears 4.5:1 on the surface it sits on. The audit measured the chosen
  // ones at 1.5–2.5:1; the derived ones cannot fail.
  const accentText = textSafe(ps1, paper);
  const accent2Text = textSafe(ps2, paper);
  // The HERO band: the festival's light gradient, and an accent that reads on
  // its darker stop. Set even when unused so the stylesheet never sees an
  // undefined var.
  const heroWash: [string, string] = festDef?.heroWash ?? [
    mix('#ffffff', festDef?.full.ps2 ?? ps2, 0.35),
    mix('#ffffff', festDef?.full.ps1 ?? ps1, 0.4),
  ];
  const heroAccent = textSafe(festDef?.full.ps1 ?? ps1, heroWash[1]);
  // The school's own ink and body text, walked until they read on the band's
  // darker stop. A light-brand school (a mint) has a light ink; on a rose
  // band it measured 2.5:1. Scoped to #home by the stylesheet, so the page
  // below keeps the school's ink untouched.
  const heroInk = textSafe(ink, heroWash[1], 4.5);
  const heroText = textSafe(textBody, heroWash[1], 4.5);

  // Each axis contributes nothing when it is at its default, which is why
  // shipping these columns repainted no existing school.
  const styleClasses = [
    sectionShapeClass(data.profile?.sectionShape),
    motionGestureClass(data.profile?.motionGesture),
    backgroundTextureClass(data.profile?.backgroundTexture),
    accentClass(data.profile?.headlineAccent),
    scrollFeelClass(data.profile?.scrollFeel),
    navDropdownAnimClass(data.profile?.navDropdownAnim),
    festiveClasses(fest),
    festDark ? 'ps-fest-dark' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    className: `ps-root ${fontVars}${motion === 0 ? ' ps-motion-off' : ''}${
      styleClasses ? ` ${styleClasses}` : ''
    }`,
    style: {
      '--ps1': ps1,
      '--ps2': ps2,
      // The label colour to put ON each brand fill, chosen by contrast rather
      // than assumed to be white. A school with a light brand (Beacon's is a
      // mint) had white text on it at 1.6:1 — unreadable, on every primary
      // button the site has. Resolved HERE because the whole stylesheet reads
      // these inline variables, and a class cannot beat an inline style.
      '--ps1-on': labelOn(ps1),
      '--ps2-on': labelOn(ps2),
      '--ink': ink,
      '--font-head': fontHead,
      '--motion': minimal ? 0.25 : motion,
      '--paper': paper,
      // Two-surface tokens (see above). The card token is the one .ps-panel
      // already reads, so the shape control and the treatments share it.
      '--ps-card-bg': panel,
      '--ps-text-strong': textStrong,
      '--ps-text': textBody,
      '--ps-muted': textMuted,
      '--ps-faint': textFaint,
      '--ps-accent-text': accentText,
      '--ps-accent2-text': accent2Text,
      '--ps-hero-a': heroWash[0],
      '--ps-hero-b': heroWash[1],
      '--ps-hero-accent': heroAccent,
      '--ps-hero-accent-on': labelOn(heroAccent),
      '--ps-hero-ink': heroInk,
      '--ps-hero-text': heroText,
      '--ps-fest-glow': festDef?.full.ps2 ?? ps2,
    } as CSSProperties,
  };
}

/**
 * Which nav entries a school has earned.
 *
 * Gated on PLAN ENTITLEMENTS rather than on whether content exists yet, so the
 * navbar stays consistent from day one — an enabled-but-empty section renders
 * an empty state instead of vanishing from the menu.
 */
export function navFlagsFor(data: PublicSiteData, opts: { hasAbout: boolean; hasAcademics: boolean; hasAdmissions: boolean; hasHof: boolean }) {
  return {
    hasAbout: opts.hasAbout,
    hasAcademics: opts.hasAcademics,
    hasAdmissions: opts.hasAdmissions,
    hasHof: opts.hasHof,
    hasGallery: data.school.features.includes('GALLERY'),
    hasEvents: data.school.features.includes('EVENTS'),
    hasAlumni: data.school.features.includes('ALUMNI'),
    hasBirthdays: !!data.celebrations?.enabled,
    hasRecords: !!data.records?.enabled,
    hasBlog: data.school.features.includes('BLOG'),
    hasContact: !!(data.profile?.phone || data.profile?.email || data.profile?.addressLine1),
    hasEnquiry: data.school.features.includes('ENQUIRY'),
  };
}
