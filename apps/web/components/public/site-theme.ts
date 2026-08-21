import type { CSSProperties } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { isNearWhite, lighten, mix } from './site-utils';
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
  let ps1 = brandColor;
  let ps2 = brandColor2;
  let paper = '#f7f5ef';
  if (fest && festDef) {
    if (fest.intensity === 'FULL') {
      ps1 = festDef.full.ps1;
      ps2 = festDef.full.ps2;
      if (festDef.fullSurface) paper = festDef.fullSurface.paper;
    } else if (fest.recolor) {
      ps2 = festDef.accent;
    }
  }
  const ink =
    fest?.intensity === 'FULL' && festDef?.fullSurface
      ? festDef.fullSurface.ink
      : mix(brandColor, '#14261d', 0.55);
  const festDark = fest?.intensity === 'FULL' && !!festDef?.fullSurface;

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
      '--ink': ink,
      '--font-head': fontHead,
      '--motion': minimal ? 0.25 : motion,
      '--paper': paper,
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
    hasBlog: data.school.features.includes('BLOG'),
    hasContact: !!(data.profile?.phone || data.profile?.email || data.profile?.addressLine1),
    hasEnquiry: data.school.features.includes('ENQUIRY'),
  };
}
