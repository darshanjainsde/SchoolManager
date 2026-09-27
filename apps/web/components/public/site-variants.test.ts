import { describe, it, expect } from 'vitest';
import {
  SCROLL_FEELS,
  scrollFeelClass,
  NAV_DROPDOWN_ANIMS,
  navDropdownAnimClass,
  SECTION_KEYS,
  SECTION_VARIANT_DEFS,
  sectionLayoutOf,
  sectionLayoutClass,
  sectionGestureClass,
  normalizeSectionVariants,
  normalizeFooterConfig,
  footerClasses,
  FESTIVALS,
  normalizeFestiveTheme,
  festiveClasses,
  sanitizeSectionCss,
  scopeSectionCss,
  buildCustomCss,
  sectionScopeSelector,
  normalizePageBlocks,
  ORDERABLE_HOME_SECTIONS,
  SECTION_ORDER_KEY,
  HOME_SECTIONS_KEY,
  HOME_SECTION_MAX,
  normalizeSectionOrder,
  normalizeHomeSections,
  sectionOrderOf,
  homeSectionsOf,
} from './site-variants';

/**
 * The iron rule every axis in this family obeys: the DEFAULT emits no class.
 * The defaults are what every existing school renders today, so shipping a new
 * axis must repaint nobody. Each first assertion below is that guarantee.
 */
describe('defaults emit no class', () => {
  it('scroll feel: CLASSIC is silent, the others are not', () => {
    expect(scrollFeelClass('CLASSIC')).toBe('');
    expect(scrollFeelClass(null)).toBe('');
    expect(scrollFeelClass(undefined)).toBe('');
    expect(scrollFeelClass('SNAP')).toBe('ps-scroll-snap');
    expect(scrollFeelClass('DECK')).toBe('ps-scroll-deck');
    expect(scrollFeelClass('GLIDE')).toBe('ps-scroll-glide');
    // Side-scroll is retired: the value stays accepted (old configs must not
    // 400 on save) but renders as Classic — silent, like the default.
    expect(scrollFeelClass('HORIZONTAL')).toBe('');
    expect(scrollFeelClass('ZOOM')).toBe('ps-scroll-zoom');
    expect(scrollFeelClass('REVEAL')).toBe('ps-scroll-reveal');
    expect(scrollFeelClass('TILT')).toBe('ps-scroll-tilt');
  });

  it('nav menu animation: FADE is silent', () => {
    expect(navDropdownAnimClass('FADE')).toBe('');
    expect(navDropdownAnimClass(null)).toBe('');
    expect(navDropdownAnimClass('SLIDE')).toBe('ps-menuanim-slide');
    expect(navDropdownAnimClass('SCALE')).toBe('ps-menuanim-scale');
  });

  it('every section: its first-listed layout is the default and is silent', () => {
    for (const key of SECTION_KEYS) {
      const def = SECTION_VARIANT_DEFS[key].layouts[0].value;
      expect(sectionLayoutOf(null, key)).toBe(def);
      expect(sectionLayoutClass(key, def)).toBe('');
      const alt = SECTION_VARIANT_DEFS[key].layouts[1].value;
      expect(sectionLayoutClass(key, alt)).toBe(`ps-v-${key}-${alt.toLowerCase()}`);
    }
  });

  it('section gesture: DEFAULT is silent', () => {
    expect(sectionGestureClass('DEFAULT')).toBe('');
    expect(sectionGestureClass(undefined)).toBe('');
    expect(sectionGestureClass('DRAW')).toBe('ps-sg-draw');
    expect(sectionGestureClass('SLIDE')).toBe('ps-sg-slide');
    expect(sectionGestureClass('ZOOM')).toBe('ps-sg-zoom');
    expect(sectionGestureClass('CURTAIN')).toBe('ps-sg-curtain');
    expect(sectionGestureClass('FLIP')).toBe('ps-sg-flip');
  });

  it('footer: null config is COLUMNS on paper with no classes', () => {
    const cfg = normalizeFooterConfig(null);
    expect(cfg).toEqual({ layout: 'COLUMNS', color: 'PAPER', social: false, contact: true, tagline: null, twoCols: false });
    expect(footerClasses(cfg)).toBe('');
    expect(footerClasses(normalizeFooterConfig({ layout: 'CENTER', color: 'DARK' }))).toBe(
      'ps-foot-center ps-footc-dark',
    );
  });

  it('festive: null stays null; LAYER names itself and never claims a takeover', () => {
    expect(normalizeFestiveTheme(null)).toBeNull();
    expect(normalizeFestiveTheme({ festival: 'NOT_A_FESTIVAL' })).toBeNull();
    expect(festiveClasses(null)).toBe('');
    const layer = normalizeFestiveTheme({ festival: 'DIWALI' })!;
    expect(layer.treatment).toBe('LAYER');
    expect(layer.intensity).toBe('LAYER');
    expect(festiveClasses(layer)).toBe('ps-fest ps-fest-layer ps-fest-diwali');
    // A row written before treatments existed: FULL on a night festival IS the night.
    const full = normalizeFestiveTheme({ festival: 'DIWALI', intensity: 'FULL' })!;
    expect(full.treatment).toBe('NIGHT');
    expect(festiveClasses(full)).toBe('ps-fest ps-fest-night ps-fest-diwali ps-fest-full');
  });

  it('every non-default option maps to a distinct class', () => {
    const scroll = SCROLL_FEELS.filter((o) => o.value !== 'CLASSIC').map((o) => scrollFeelClass(o.value));
    expect(new Set(scroll).size).toBe(scroll.length);
    const anims = NAV_DROPDOWN_ANIMS.filter((o) => o.value !== 'FADE').map((o) => navDropdownAnimClass(o.value));
    expect(new Set(anims).size).toBe(anims.length);
  });

  it('every festival offers at least two scenes, distinct by value, and a full palette', () => {
    for (const f of FESTIVALS) {
      expect(f.variants.length).toBeGreaterThanOrEqual(2);
      expect(new Set(f.variants.map((v) => v.value)).size).toBe(f.variants.length);
      expect(f.full.ps1).toMatch(/^#[0-9a-f]{6}$/i);
      expect(f.full.ps2).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('a row saved with an old emoji-set variant falls to the festival\u2019s default scene, whatever the treatment', () => {
    for (const treatment of ['LAYER', 'CHROME', 'HERO', 'WASH', 'NIGHT']) {
      const fest = normalizeFestiveTheme({ festival: 'DIWALI', variant: 'FIREWORKS', treatment })!;
      expect(fest.variant).toBe('DEEPAVALI');
    }
    expect(normalizeFestiveTheme({ festival: 'GANESH', variant: 'MODAK' })!.variant).toBe('MODAK');
  });

  it('the picture slot survives normalisation only as a non-empty string', () => {
    expect(normalizeFestiveTheme({ festival: 'GANESH', imageAssetId: 'asset-1' })!.imageAssetId).toBe('asset-1');
    expect(normalizeFestiveTheme({ festival: 'GANESH', imageAssetId: '' })!.imageAssetId).toBeNull();
    expect(normalizeFestiveTheme({ festival: 'GANESH', imageAssetId: 7 })!.imageAssetId).toBeNull();
  });

  it('keeps only known sections, layouts and gestures', () => {
    const out = normalizeSectionVariants({
      stats: { layout: 'RINGS', gesture: 'FADE' },
      about: { layout: 'NOT_REAL', gesture: 'EXPLODE' },
      bogus: { layout: 'CARDS' },
      gallery: 'not-an-object',
    });
    expect(out).toEqual({ stats: { layout: 'RINGS', gesture: 'FADE' } });
  });
  it('tolerates null/garbage roots', () => {
    expect(normalizeSectionVariants(null)).toEqual({});
    expect(normalizeSectionVariants('x')).toEqual({});
    expect(normalizeSectionVariants(42)).toEqual({});
  });
});

/**
 * THE ESCAPE HATCH IS ONLY SAFE IF THESE HOLD. An operator pastes a snippet
 * (often generated by an assistant) to restyle ONE section of ONE school; the
 * sanitizer + scoper are what keep that from becoming an XSS vector or a
 * page-wide repaint.
 */
describe('custom CSS: sanitize', () => {
  it('a style-tag breakout cannot survive (no "<" at all)', () => {
    const out = sanitizeSectionCss('.a{color:red}</style><script>alert(1)</script>');
    expect(out).not.toContain('<');
  });
  it('@import and @charset are stripped', () => {
    const out = sanitizeSectionCss("@import url('https://evil.example/x.css'); .a{color:red}");
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('.a{color:red}');
  });
  it('external url() is neutralized, data: URIs survive', () => {
    const out = sanitizeSectionCss(
      '.a{background:url(https://evil.example/p.png)} .b{background:url(data:image/svg+xml;base64,abc)}',
    );
    expect(out).not.toContain('evil.example/p.png}');
    expect(out).toContain('about:invalid#');
    expect(out).toContain('url(data:image/svg+xml;base64,abc)');
  });
  it('expression() and javascript: are defused', () => {
    const out = sanitizeSectionCss('.a{width:expression(alert(1));background:javascript:x}');
    expect(out).not.toMatch(/(^|[^-])expression\s*\(/i);
    expect(out).not.toMatch(/javascript\s*:/i);
  });
  it('CSS hex escapes cannot hide @import or url() from the scanner', () => {
    expect(sanitizeSectionCss('@\\69mport "https://evil.example/x.css";').toLowerCase()).not.toContain('@import');
    expect(sanitizeSectionCss('@\\69mport "https://evil.example/x.css";')).not.toContain('evil.example');
    // url() is neutralized to an inert about:invalid fragment — the external
    // target may survive as text after the '#', but it can never be fetched.
    const u = sanitizeSectionCss('.a{background:u\\72l(https://evil.example/p.png)}');
    expect(u).toContain('url(about:invalid#');
    expect(u).not.toMatch(/url\(\s*['"]?https?:/i);
  });
});

describe('custom CSS: scope', () => {
  const SCOPE = '.ps-root [data-sec="stats"]';

  it('prefixes every selector, including comma lists', () => {
    const out = scopeSectionCss(SCOPE, '.ps-panel, .count { color: gold; } h2{margin:0}');
    expect(out).toContain(`${SCOPE} .ps-panel`);
    expect(out).toContain(`${SCOPE} .count`);
    expect(out).toContain(`${SCOPE} h2{margin:0}`);
  });

  it(':root/html/body collapse to the scope itself instead of escaping it', () => {
    const out = scopeSectionCss(SCOPE, ':root{--x:1} body{background:red}');
    expect(out).toContain(`${SCOPE}{--x:1}`);
    expect(out).toContain(`${SCOPE}{background:red}`);
    expect(out).not.toMatch(/(^|\})\s*body\s*\{/);
  });

  it('a pasted ANIMATION snippet works: keyframes pass through whole, media queries scope inside', () => {
    // The acceptance case from the pitch: an admin pastes a wholly different
    // entrance animation for one section, generated outside the platform.
    const snippet = `
      @keyframes spinIn { from { transform: rotate(-8deg) scale(.8); opacity: 0 } to { transform: none; opacity: 1 } }
      .reveal.in { animation: spinIn .7s cubic-bezier(.2,.7,.2,1) both; }
      .ps-panel { border: 2px dashed gold; }
      @media (max-width: 640px) { .ps-panel { border-width: 1px; } }
    `;
    const out = scopeSectionCss(SCOPE, snippet);
    // Keyframes arrive intact and unprefixed — percent steps are not selectors.
    expect(out).toMatch(/@keyframes spinIn\{[^}]*from \{ transform: rotate\(-8deg\)/);
    // The rules that use them are confined to the section.
    expect(out).toContain(`${SCOPE} .reveal.in{`);
    expect(out).toContain(`${SCOPE} .ps-panel{`);
    // Inside the media query the scope still applies.
    expect(out).toMatch(/@media \(max-width: 640px\)\{[\s\S]*\[data-sec="stats"\] \.ps-panel\{/);
  });

  it('every top-level rule starts with the scope — nothing reaches outside the section', () => {
    const out = scopeSectionCss(SCOPE, '.x{a:1} h2, .y > i{b:2} #z{c:3}');
    // Split on closing braces: each fragment holding a selector must carry it.
    for (const frag of out.split('}').filter((f) => f.includes('{'))) {
      expect(frag).toContain('[data-sec="stats"]');
    }
  });

  it('buildCustomCss combines only known sections and ignores junk keys', () => {
    const css = buildCustomCss({
      stats: '.ps-panel{color:red}',
      hero: 'h1{letter-spacing:.1em}',
      '../evil': '.x{color:blue}',
      notASection: '.y{color:green}',
    });
    expect(css).toContain(sectionScopeSelector('stats'));
    expect(css).toContain(sectionScopeSelector('hero'));
    expect(css).not.toContain('color:blue');
    expect(css).not.toContain('color:green');
  });

  it('unbalanced braces cannot smuggle a trailing unscoped rule', () => {
    const out = scopeSectionCss(SCOPE, '.a{color:red} } .escape{color:blue}');
    expect(out).not.toMatch(/(^|\})\s*\.escape\s*\{/);
  });
});

describe('page blocks normalize defensively', () => {
  it('keeps valid blocks, drops junk, caps lengths', () => {
    const out = normalizePageBlocks([
      { t: 'h', text: 'Scholarships' },
      { t: 'p', text: 'Merit and need-based aid.' },
      { t: 'img', url: 'https://cdn.example/x.jpg', caption: 'Campus' },
      { t: 'img', url: 'javascript:alert(1)' },
      { t: 'cta', label: 'Ask us', href: 'javascript:alert(1)' },
      { t: 'cta', label: 'Call', href: 'tel:+911234567890' },
      { t: 'nope', text: 'x' },
      'garbage',
    ]);
    expect(out).toEqual([
      { t: 'h', text: 'Scholarships' },
      { t: 'p', text: 'Merit and need-based aid.' },
      { t: 'img', url: 'https://cdn.example/x.jpg', caption: 'Campus' },
      { t: 'cta', label: 'Ask us', href: null },
      { t: 'cta', label: 'Call', href: 'tel:+911234567890' },
    ]);
  });
  it('non-arrays become empty pages, never throws', () => {
    expect(normalizePageBlocks(null)).toEqual([]);
    expect(normalizePageBlocks({})).toEqual([]);
  });
});

/**
 * Band order + admin-built homepage sections. Both ride inside the
 * sectionVariants Json under reserved keys, so the iron rules here are:
 * nothing saved → exactly today's order (repaint nobody), and the reserved
 * keys never bleed into the per-band variant normalizer.
 */
describe('homepage band order', () => {
  const DEFAULT = ORDERABLE_HOME_SECTIONS.map((s) => s.key);

  it('nothing saved resolves to today’s order exactly', () => {
    expect(normalizeSectionOrder(undefined)).toEqual(DEFAULT);
    expect(normalizeSectionOrder(null)).toEqual(DEFAULT);
    expect(normalizeSectionOrder([])).toEqual(DEFAULT);
    expect(sectionOrderOf(null)).toEqual(DEFAULT);
    expect(sectionOrderOf({ stats: { layout: 'RINGS' } })).toEqual(DEFAULT);
  });

  it('a saved order leads; unknown keys drop; missing bands keep their default slot', () => {
    const out = normalizeSectionOrder(['about', 'NOT_REAL', 'stats', 'about']);
    expect(out.slice(0, 2)).toEqual(['about', 'stats']);
    expect(out).toHaveLength(DEFAULT.length);
    expect(new Set(out)).toEqual(new Set(DEFAULT));
  });

  it('custom sections join as x:<id> and default to the end of the page', () => {
    const out = normalizeSectionOrder(undefined, ['team']);
    expect(out[out.length - 1]).toBe('x:team');
    const placed = normalizeSectionOrder(['x:team', 'about'], ['team']);
    expect(placed.slice(0, 2)).toEqual(['x:team', 'about']);
  });

  it('reads the reserved key out of the variants blob', () => {
    const blob = { [SECTION_ORDER_KEY]: ['contact', 'stats'], stats: { layout: 'RINGS' } };
    expect(sectionOrderOf(blob).slice(0, 2)).toEqual(['contact', 'stats']);
  });

  it('reserved keys never leak into the per-band variant normalizer', () => {
    const blob = {
      stats: { layout: 'RINGS' },
      [SECTION_ORDER_KEY]: ['contact'],
      [HOME_SECTIONS_KEY]: [{ id: 'team', title: 'Team', blocks: [] }],
    };
    expect(normalizeSectionVariants(blob)).toEqual({ stats: { layout: 'RINGS' } });
  });
});

describe('admin-built homepage sections', () => {
  it('normalizes real sections and rejects garbage', () => {
    const out = normalizeHomeSections([
      { id: 'Team!', title: '  Our team  ', blocks: [{ t: 'p', text: 'Hello' }] },
      { id: 'team', title: 'Duplicate id after slugging', blocks: [] },
      { id: '', title: 'No id', blocks: [] },
      { id: 'empty', title: '', blocks: [] },
      'garbage',
      null,
    ]);
    expect(out).toEqual([{ id: 'team', title: 'Our team', blocks: [{ t: 'p', text: 'Hello' }] }]);
  });

  it('caps the section count and re-normalizes blocks through the page pipeline', () => {
    const many = Array.from({ length: HOME_SECTION_MAX + 3 }, (_, i) => ({
      id: `s${i}`, title: `S${i}`, blocks: [{ t: 'img', url: 'javascript:alert(1)' }],
    }));
    const out = normalizeHomeSections(many);
    expect(out).toHaveLength(HOME_SECTION_MAX);
    // the unsafe image url was dropped by normalizePageBlocks
    expect(out.every((s) => s.blocks.length === 0)).toBe(true);
  });

  it('homeSectionsOf reads the reserved key and tolerates junk blobs', () => {
    expect(homeSectionsOf(null)).toEqual([]);
    expect(homeSectionsOf('x')).toEqual([]);
    expect(homeSectionsOf({ [HOME_SECTIONS_KEY]: [{ id: 'a', title: 'A', blocks: [] }] })).toEqual([
      { id: 'a', title: 'A', blocks: [] },
    ]);
  });
});

/**
 * A festival is only real if a scene draws it. The renderer map and the option
 * list are two files (one pure, one React); this keeps them in step.
 */
describe('every festival has a scene', () => {
  it('SCENES and SCENE_VARIANTS cover exactly the festival catalogue', async () => {
    const { SCENES } = await import('./festive/scenes');
    const { SCENE_VARIANTS } = await import('./festive/scene-variants');
    const keys = FESTIVALS.map((f) => f.value).sort();
    expect(Object.keys(SCENES).sort()).toEqual(keys);
    expect(Object.keys(SCENE_VARIANTS).sort()).toEqual(keys);
  });
});

import { TREATMENTS, festivalsFor, treatmentsFor } from './site-variants';

describe('festive treatments — the same five for every festival', () => {
  it('names five, in loudness order', () => {
    expect(TREATMENTS.map((t) => t.value)).toEqual(['LAYER', 'CHROME', 'HERO', 'WASH', 'NIGHT']);
  });
  it('every festival offers LAYER and CHROME; NIGHT only where a night surface exists or is declared', () => {
    for (const f of FESTIVALS) {
      const offered = treatmentsFor(f);
      expect(offered).toContain('LAYER');
      expect(offered).toContain('CHROME');
      if (!f.treatments) expect(offered.includes('NIGHT')).toBe(!!f.fullSurface);
    }
    expect(treatmentsFor(FESTIVALS.find((f) => f.value === 'INDEPENDENCE')!)).not.toContain('NIGHT');
    expect(treatmentsFor(FESTIVALS.find((f) => f.value === 'DIWALI')!)).toContain('NIGHT');
  });
  it('a treatment the festival does not offer falls to one it does, never to nothing', () => {
    const t = normalizeFestiveTheme({ festival: 'INDEPENDENCE', treatment: 'NIGHT' })!;
    expect(treatmentsFor(FESTIVALS.find((f) => f.value === 'INDEPENDENCE')!)).toContain(t.treatment);
    expect(t.treatment).toBe('WASH');
    const g = normalizeFestiveTheme({ festival: 'GANDHI', treatment: 'HERO' })!;
    expect(g.treatment).toBe('LAYER');
  });
  it('old rows keep their shape: FULL without a night surface was a light retint, which is WASH', () => {
    expect(normalizeFestiveTheme({ festival: 'HOLI', intensity: 'FULL' })!.treatment).toBe('WASH');
    expect(normalizeFestiveTheme({ festival: 'HOLI', intensity: 'LAYER' })!.treatment).toBe('LAYER');
    expect(normalizeFestiveTheme({ festival: 'HOLI' })!.treatment).toBe('LAYER');
  });
  it('an unknown treatment string is ignored, not trusted', () => {
    expect(normalizeFestiveTheme({ festival: 'DIWALI', treatment: 'GLITTER' })!.treatment).toBe('LAYER');
  });
  it('WASH and NIGHT report FULL to readers written before treatments existed', () => {
    expect(normalizeFestiveTheme({ festival: 'DIWALI', treatment: 'NIGHT' })!.intensity).toBe('FULL');
    expect(normalizeFestiveTheme({ festival: 'DIWALI', treatment: 'WASH' })!.intensity).toBe('FULL');
    expect(normalizeFestiveTheme({ festival: 'DIWALI', treatment: 'HERO' })!.intensity).toBe('LAYER');
  });
});

describe('the country switch, as the Studio sees it', () => {
  it('every festival in the catalogue is on India\u2019s calendar today', () => {
    for (const f of FESTIVALS) expect(f.countries).toContain('IN');
    expect(festivalsFor('IN').map((f) => f.value)).toEqual(FESTIVALS.map((f) => f.value));
  });
  it('a country with no pack of its own inherits India\u2019s festivals — the same for all countries, today', () => {
    for (const c of ['AE', 'GB', 'NP', undefined, null, '']) {
      expect(festivalsFor(c).map((f) => f.value)).toEqual(FESTIVALS.map((f) => f.value));
    }
  });
  it('the Indian calendar covers the days a school actually marks', () => {
    const keys = FESTIVALS.map((f) => f.value);
    for (const k of ['DIWALI', 'NAVRATRI', 'HOLI', 'EID', 'INDEPENDENCE', 'REPUBLIC', 'DURGA', 'VASANT', 'UGADI', 'BAISAKHI', 'GURUNANAK', 'LOHRI', 'GANDHI', 'CHILDRENS', 'TEACHERS', 'GANESH', 'ONAM', 'SANKRANTI', 'RAKSHA', 'JANMASHTAMI', 'CHRISTMAS', 'NEWYEAR']) {
      expect(keys).toContain(k);
    }
  });
});
