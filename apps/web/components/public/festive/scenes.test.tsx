/**
 * Every festival's every scene renders — deterministically, with its own
 * objects, from shipped art that exists and weighs little — under the
 * treatments a school can pick. This is the guard that stops "all festivals
 * look the same" from coming back: two festivals may never emit the same dress.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FESTIVALS, normalizeFestiveTheme, TREATMENTS } from '../site-variants';
import { SCENES } from './scenes';
import { SCENE_VARIANTS } from './scene-variants';
import { FestiveDress } from '../sections/FestiveLayer';

const dress = (festival: string, variant: string, treatment = 'HERO', extra: Record<string, unknown> = {}, imageUrl: string | null = null) =>
  renderToStaticMarkup(<FestiveDress fest={normalizeFestiveTheme({ festival, variant, treatment, ...extra })} imageUrl={imageUrl} />);

const PUBLIC = resolve(process.cwd(), 'public');

describe('the scene registry', () => {
  it('covers every festival, and every variant value is unique within its festival', () => {
    for (const f of FESTIVALS) {
      expect(SCENES[f.value], f.value).toBeTypeOf('function');
      const values = SCENE_VARIANTS[f.value].map((v) => v.value);
      expect(new Set(values).size, f.value).toBe(values.length);
      for (const v of SCENE_VARIANTS[f.value]) {
        expect(v.label.length, `${f.value}.${v.value} label`).toBeGreaterThan(2);
        expect(v.hint.length, `${f.value}.${v.value} hint`).toBeGreaterThan(10);
      }
    }
  });
});

describe('every scene renders', () => {
  const cases = FESTIVALS.flatMap((f) => f.variants.map((v) => [f.value, v.value] as const));
  it.each(cases)('%s · %s draws something, deterministically, with no greeting and no emoji', (festival, variant) => {
    const a = dress(festival, variant);
    const b = dress(festival, variant);
    expect(a).toBe(b); // no Math.random / Date in render
    expect(a).toContain(`data-fest-scene="${variant}"`);
    expect(a.length, 'an empty dress').toBeGreaterThan(200);
    expect(a).toMatch(/<svg|<img|class="ps-fest-|class="ps-fx-/);
    expect(a).not.toMatch(/Happy|Shubh|wishes/i);
    expect(a).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('renders under every treatment the festival offers, and turns its lights up at night', () => {
    for (const f of FESTIVALS) {
      for (const t of TREATMENTS) {
        const html = dress(f.value, f.variants[0].value, t.value);
        // A treatment the festival does not offer normalises to one it does; the dress still draws.
        expect(html, `${f.value} ${t.value}`).toContain('data-fest-dress=');
      }
    }
  });

  it('no <span> lands inside an <svg> (a falling field inside a drawing is invisible in the browser)', () => {
    for (const f of FESTIVALS) for (const v of f.variants) {
      const html = dress(f.value, v.value);
      let depth = 0;
      for (const m of html.matchAll(/<(\/?)(svg|span)\b/g)) {
        if (m[2] === 'svg') depth += m[1] ? -1 : 1;
        else if (!m[1]) expect(depth, `${f.value}.${v.value}: <span> inside <svg>`).toBe(0);
      }
    }
  });
});

describe('two festivals never look the same', () => {
  it('the default scene of every festival is distinct markup from every other festival’s', () => {
    const seen = new Map<string, string>();
    for (const f of FESTIVALS) {
      // Independence and Republic Day share the tiranga on purpose.
      const key = f.value === 'REPUBLIC' ? 'INDEPENDENCE' : f.value;
      const html = dress(f.value, f.variants[0].value).replace(/data-fest-scene="[^"]*"/, '');
      const dup = [...seen.entries()].find(([k, h]) => k !== key && h === html);
      expect(dup?.[0], `${f.value} renders the same dress as ${dup?.[0]}`).toBeUndefined();
      seen.set(key, html);
    }
  });
  it('the variants of one festival are distinct from each other', () => {
    for (const f of FESTIVALS) {
      const htmls = f.variants.map((v) => dress(f.value, v.value).replace(/data-fest-scene="[^"]*"/, ''));
      expect(new Set(htmls).size, f.value).toBe(htmls.length);
    }
  });
});

describe('pictures', () => {
  const pictureScenes = FESTIVALS.flatMap((f) => f.variants.filter((v) => v.picture).map((v) => [f.value, v.value] as const));
  it('exist: every picture scene ships a public-domain painting that is on disk and credited', () => {
    expect(pictureScenes.length).toBeGreaterThanOrEqual(5);
    const credits = readFileSync(resolve(PUBLIC, 'festive/art/CREDITS.md'), 'utf8');
    for (const [festival, variant] of pictureScenes) {
      const html = dress(festival, variant);
      const src = html.match(/<img[^>]*src="([^"]+)"/)?.[1];
      expect(src, `${festival}.${variant} has no <img>`).toMatch(/^\/festive\/art\/[a-z]+\.webp$/);
      expect(existsSync(resolve(PUBLIC, src!.slice(1))), `${src} missing on disk`).toBe(true);
      expect(credits, `${src} not in CREDITS.md`).toContain(src!.split('/').pop()!);
      expect(html, 'the painting carries its credit').toContain('ps-fest-credit');
    }
  });
  it('weigh little: each painting under 150 KB, all of them under 500 KB', () => {
    let total = 0;
    for (const name of ['lakshmi', 'ganesha', 'saraswati', 'durga', 'krishna']) {
      const size = statSync(resolve(PUBLIC, `festive/art/${name}.webp`)).size;
      expect(size, name).toBeLessThan(150 * 1024);
      total += size;
    }
    expect(total).toBeLessThan(500 * 1024);
  });
  it('the school’s own picture replaces the painting and its credit, but only while the theme names the asset', () => {
    const own = dress('GANESH', 'MURTI', 'HERO', { imageAssetId: 'a-1' }, 'https://cdn.example.com/murti.jpg');
    expect(own).toContain('src="https://cdn.example.com/murti.jpg"');
    expect(own).not.toContain('ps-fest-credit');
    const stale = dress('GANESH', 'MURTI', 'HERO', {}, 'https://cdn.example.com/murti.jpg');
    expect(stale).toContain('/festive/art/ganesha.webp');
  });
  it('a non-picture scene ignores an uploaded picture', () => {
    const html = dress('GANESH', 'MODAK', 'HERO', { imageAssetId: 'a-1' }, 'https://cdn.example.com/murti.jpg');
    expect(html).not.toContain('cdn.example.com');
  });
});

describe('the festival’s own objects are there', () => {
  // The user's list, checked against the markup: each scene must contain the thing it is named for.
  const expectations: Array<[string, string, RegExp]> = [
    ['DIWALI', 'DEEPAVALI', /ps-fx-flame/],           // lit diyas
    ['DIWALI', 'LANTERNS', /ps-fx-swing/],            // kandils swinging
    ['HOLI', 'SPLASH', /ps-fx-spray/],                // pichkari spray
    ['EID', 'CHAAND', /ps-fest-stars/],               // the night sky
    ['NAVRATRI', 'DANDIYA', /ps-fx-clash-l/],         // sticks clashing
    ['NAVRATRI', 'DUSSEHRA', /ps-fx-burn/],           // the effigy alight
    ['GANESH', 'MURTI', /ganesha\.webp/],
    ['JANMASHTAMI', 'MATKI', /ps-fx-pendulum/],       // the matki swinging
    ['JANMASHTAMI', 'FEATHER', /ps-fx-sway/],         // mor pankh
    ['CHRISTMAS', 'TREE', /ps-fx-blink/],             // tree lights
    ['CHRISTMAS', 'LIGHTS', /ps-fest-flake/],         // snow
    ['ONAM', 'POOKALAM', /ps-fx-bloom/],
    ['ONAM', 'BOAT', /ps-fx-glide/],
    ['SANKRANTI', 'KITES', /ps-fx-kite/],
    ['INDEPENDENCE', 'FLAG', /ps-fx-wave/],
    ['GANDHI', 'CHARKHA', /ps-fx-spin-slow/],
    ['TEACHERS', 'BOARD', /ps-fx-chalk/],
    ['LOHRI', 'BONFIRE', /ps-fx-burn/],
    ['RAKSHA', 'RAKHI', /ps-fx-spin-slow/],
  ];
  it.each(expectations)('%s · %s contains %s', (festival, variant, re) => {
    expect(dress(festival, variant)).toMatch(re);
  });
});
