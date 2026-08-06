import { describe, it, expect } from 'vitest';
import {
  MOTION_GESTURES,
  BACKGROUND_TEXTURES,
  STYLE_PRESETS,
  motionGestureClass,
  backgroundTextureClass,
  accentClass,
} from './site-style';
import { SECTION_SHAPES } from './section-shape';

/**
 * THE REST OF THE CUSTOMISATION INCREMENT.
 *
 * Section shape fixed WHERE the page differs. These three fix WHAT differs:
 * the gesture a section makes as it arrives, the ground it sits on, and
 * whether the school's headline motif is allowed off the headline.
 *
 * Every one follows the same rule section shape set: the DEFAULT emits no
 * class, because the default is what every existing school already renders and
 * shipping a column must repaint nobody.
 */
describe('motion is a gesture, not a volume knob', () => {
  it('offers the three gestures a section can make', () => {
    expect(MOTION_GESTURES.map((g) => g.value)).toEqual(['RISE', 'FADE', 'DRAW']);
  });

  it('adds no class for RISE — that is the reveal every site already does', () => {
    expect(motionGestureClass('RISE')).toBe('');
    expect(motionGestureClass(undefined)).toBe('');
  });

  it('names a class for the gestures that change something', () => {
    expect(motionGestureClass('FADE')).toBe('ps-gesture-fade');
    expect(motionGestureClass('DRAW')).toBe('ps-gesture-draw');
  });

  it('is a separate axis from animationLevel, which still silences everything', () => {
    // The gesture says WHAT a section does; animationLevel says how much, and
    // NONE still means none. Collapsing them would take the off switch away
    // from a school that asked for stillness.
    expect(MOTION_GESTURES.map((g) => g.value)).not.toContain('NONE');
  });
});

describe('the ground the page sits on', () => {
  it('offers plain paper plus three textures', () => {
    expect(BACKGROUND_TEXTURES.map((t) => t.value)).toEqual(['NONE', 'GRID', 'DOTS', 'PAPER']);
  });

  it('adds no class for NONE, which is what every site renders today', () => {
    expect(backgroundTextureClass('NONE')).toBe('');
    expect(backgroundTextureClass(undefined)).toBe('');
  });

  it('names a class for each real texture', () => {
    expect(backgroundTextureClass('GRID')).toBe('ps-texture-grid');
    expect(backgroundTextureClass('DOTS')).toBe('ps-texture-dots');
    expect(backgroundTextureClass('PAPER')).toBe('ps-texture-paper');
  });
});

describe('letting the headline motif off the headline', () => {
  it('carries the school’s existing accent onto section headings', () => {
    // Reuses headlineAccent rather than inventing a second control: two
    // settings that could disagree about one motif is how a page stops
    // looking like one page.
    expect(accentClass('DRAW')).toBe('ps-accent-draw');
    expect(accentClass('MARKER')).toBe('ps-accent-marker');
    expect(accentClass('GROW')).toBe('ps-accent-grow-on');
  });

  it('adds nothing when the school turned the motif off', () => {
    expect(accentClass('NONE')).toBe('');
    expect(accentClass(undefined)).toBe('');
  });
});

describe('the six presets', () => {
  it('offers six, because twelve dropdowns is not a choice most admins will make', () => {
    expect(STYLE_PRESETS).toHaveLength(6);
  });

  it('gives every preset a name and a line saying who it suits', () => {
    for (const p of STYLE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(15);
    }
  });

  it('sets every axis, so applying one never leaves a half-changed page', () => {
    const shapes = SECTION_SHAPES.map((s) => s.value);
    const gestures = MOTION_GESTURES.map((g) => g.value);
    const textures = BACKGROUND_TEXTURES.map((t) => t.value);
    for (const p of STYLE_PRESETS) {
      expect(shapes).toContain(p.values.sectionShape);
      expect(gestures).toContain(p.values.motionGesture);
      expect(textures).toContain(p.values.backgroundTexture);
      expect(['DRAW', 'MARKER', 'GROW', 'NONE']).toContain(p.values.headlineAccent);
    }
  });

  it('is six DIFFERENT looks — no two presets are the same four values', () => {
    const seen = STYLE_PRESETS.map((p) => JSON.stringify(p.values));
    expect(new Set(seen).size).toBe(STYLE_PRESETS.length);
  });

  it('starts from the one every existing school is already wearing', () => {
    // A preset list where none matches the current default would tell every
    // school its own look is not on the menu.
    expect(STYLE_PRESETS.map((p) => p.values)).toContainEqual({
      sectionShape: 'SOFT',
      motionGesture: 'RISE',
      backgroundTexture: 'NONE',
      headlineAccent: 'DRAW',
    });
  });
});
