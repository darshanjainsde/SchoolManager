/**
 * The design subset of SchoolProfile — the keys a saved look (DesignDraft)
 * may carry, and the keys a scheduled look overlays onto the public
 * projection at read time. Pure module: imported by the CMS services and by
 * the public projection without dragging either's Nest graph along.
 *
 * Everything else on the profile is CONTENT (contact details, labels, the
 * menu arrangement's slugs) and does not belong to a look.
 */
export const DESIGN_CONFIG_KEYS = [
  'brandColorPrimary',
  'brandColorSecondary',
  'headingFont',
  'animationLevel',
  'themePreset',
  'heroLayout',
  'heroTextAlign',
  'heroOverlayStyle',
  'heroOverlayOpacity',
  'heroHeight',
  'headlineAccent',
  'sectionShape',
  'motionGesture',
  'backgroundTexture',
  'navStyle',
  'navColor',
  'navTextColor',
  'navLoginStyle',
  'scrollFeel',
  'navDropdownAnim',
  'heroMedia',
  'heroVideoUrl',
  'sectionVariants',
  'festiveTheme',
  'footerConfig',
] as const;

export function pickDesignConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DESIGN_CONFIG_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}
