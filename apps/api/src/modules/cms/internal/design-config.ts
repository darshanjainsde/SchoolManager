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
  'navCtaLabel',
  'navShowCta',
  'navLoginLabel',
  'navShowLogin',
  'navConfig',
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

/** sectionVariants keys that are CONTENT, not styling: the admin-built
 *  homepage sections and their band order (see the web side's
 *  site-variants.ts). A look carries per-band styling only, so when a draft
 *  is published — or a scheduled look overlays the profile at read time —
 *  its sectionVariants must never delete or hide these: strip them from the
 *  look's copy and carry the live profile's values forward unchanged. */
const SECTION_CONTENT_KEYS = ['__order', '__custom'] as const;

export function mergeSectionVariantContent(incoming: unknown, live: unknown): Record<string, unknown> {
  const out: Record<string, unknown> =
    incoming && typeof incoming === 'object' ? { ...(incoming as Record<string, unknown>) } : {};
  for (const k of SECTION_CONTENT_KEYS) delete out[k];
  if (live && typeof live === 'object') {
    for (const k of SECTION_CONTENT_KEYS) {
      const v = (live as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
