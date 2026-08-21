import { describe, it, expect } from 'vitest';
import { START_THEMES, themeInUse } from './start-themes';

/**
 * A theme is published by PUTting its config to /site/profile, so every value
 * MUST sit inside the API's @IsIn allow-lists (cms.dto.ts) or the publish 400s.
 * This mirrors those lists so a theme can never drift into an invalid value.
 */
const ALLOWED = {
  headingFont: ['INTER', 'FRAUNCES', 'POPPINS', 'NUNITO'],
  animationLevel: ['FULL', 'SUBTLE', 'NONE'],
  heroLayout: ['ILLUSTRATION', 'FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'COLLAGE', 'SLIDESHOW', 'MINIMAL'],
  heroTextAlign: ['LEFT', 'CENTER'],
  heroOverlayStyle: ['WASH', 'TINT', 'DARK'],
  heroHeight: ['FULL', 'COMPACT'],
  headlineAccent: ['DRAW', 'MARKER', 'GROW', 'NONE'],
  sectionShape: ['SOFT', 'EDITORIAL', 'CRISP'],
  motionGesture: ['RISE', 'FADE', 'DRAW'],
  backgroundTexture: ['NONE', 'GRID', 'DOTS', 'PAPER'],
  scrollFeel: ['CLASSIC', 'GLIDE', 'SNAP', 'DECK'],
  navStyle: ['CLASSIC', 'CENTER', 'PILL', 'STRIP', 'GHOST'],
  navColor: ['PAPER', 'WHITE', 'DARK', 'BRAND'],
  navTextColor: ['AUTO', 'LIGHT', 'DARK'],
  navLoginStyle: ['LINK', 'OUTLINE', 'SOLID'],
} as const;

describe('start themes are all publish-safe', () => {
  it('has a unique id and complete metadata for each theme', () => {
    const ids = START_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of START_THEMES) {
      expect(t.name && t.audience && t.blurb).toBeTruthy();
    }
  });

  it.each(START_THEMES)('$name uses only allowed enum values', (theme) => {
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      const v = (theme.config as unknown as Record<string, unknown>)[key];
      expect(allowed as readonly string[], `${theme.name}.${key} = ${String(v)}`).toContain(v);
    }
    // Colours must be valid hex (the API's @IsHexColor).
    expect(theme.config.brandColorPrimary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.config.brandColorSecondary).toMatch(/^#[0-9a-f]{6}$/i);
    // Overlay opacity within @Min(10) @Max(95).
    expect(theme.config.heroOverlayOpacity).toBeGreaterThanOrEqual(10);
    expect(theme.config.heroOverlayOpacity).toBeLessThanOrEqual(95);
    // Footer within its normalizer's shapes.
    expect(['COLUMNS', 'SIMPLE', 'CENTER']).toContain(theme.config.footerConfig.layout);
    expect(['PAPER', 'DARK', 'BRAND']).toContain(theme.config.footerConfig.color);
  });

  it('themeInUse matches an exactly-applied theme and rejects a different one', () => {
    const t = START_THEMES[0];
    expect(themeInUse(t, { ...t.config })).toBe(true);
    expect(themeInUse(t, { ...t.config, navStyle: 'GHOST' })).toBe(false);
    expect(themeInUse(t, {})).toBe(false);
  });
});
