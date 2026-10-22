// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards for the static marketing bundle (public/site-preview/*.html).
 *
 * The four route files are ONE page with four heads, derived by
 * scripts/site-preview-sync.mjs. These checks exist because each line was a
 * defect a visitor could see on 20 Oct 2026:
 *  - the quote builder printed ₹90/₹120 (sample rates) until the next click;
 *  - the home page said "shipped in the last two weeks" six weeks later;
 *  - plan taglines on the home page disagreed with the pricing page;
 *  - the crawlable body was 41 words because everything was built by script.
 */
const dir = resolve(__dirname, '../public/site-preview');
const read = (f: string) => readFileSync(resolve(dir, f), 'utf8');
const body = (html: string) => html.slice(html.indexOf('</head>')).replace(/<!--ssr:start-->[\s\S]*?<!--ssr:end-->/, '');
const ROUTES: Record<string, string> = { index: '/', pricing: '/pricing', features: '/features', start: '/start' };

describe('site-preview bundle', () => {
  const index = read('index.html');

  it('serves the same body on all four routes, each with its own canonical', () => {
    for (const [file, path] of Object.entries(ROUTES)) {
      const html = read(`${file}.html`);
      expect(body(html), `${file}.html body drifted from index.html — run scripts/site-preview-sync.mjs`).toBe(body(index));
      expect(html).toContain(`<link rel="canonical" href="https://sckools.com${path}">`);
      expect(html).toContain(`<meta property="og:url" content="https://sckools.com${path}">`);
    }
  });

  it('says the plain words a school searches for', () => {
    expect(index).toMatch(/<title>[^<]*School Website[^<]*Management Software[^<]*<\/title>/);
    expect(body(index)).toContain('school management software (what most vendors call an ERP)');
  });

  it('starts from the published rates so the quote builder never shows a sample price', () => {
    expect(index).toContain('const PRICES={basic:{inr:30,usd:1},standard:{inr:45,usd:2},pro:{inr:60,usd:3}};');
    expect(index).toContain("if(typeof refreshJourney===\"function\"&&document.getElementById('jy-panel'))refreshJourney();");
    expect(index).not.toContain('<span data-from>₹60</span>');
  });

  it('never dates itself with "two weeks" or boasts a shipped count in the hero', () => {
    expect(index).not.toMatch(/Shipped in the last two weeks/);
    expect(index).not.toContain('shipped in 2 weeks');
  });

  it('uses one set of plan taglines and nothing is "on request" any more', () => {
    expect(index).not.toContain("'Be engaging.'");
    expect(index).not.toContain("'Be the stage.'");
    expect(index).not.toContain("'Join the network.'");
    expect(index).not.toContain("'Run the school.'");
    expect(index).not.toContain('exam hall — on request');
    expect(index).not.toContain('switched on at onboarding');
    expect(index).not.toContain('>On request<');
    expect(index).toContain("'Be found.'");
    expect(index).toContain("'Run the day.'");
    expect(index).toContain("'Run everything.'");
  });

  it('every feature tile names a key one of the three plans carries, so no pill can read "on request"', () => {
    const tiers = /const TIER_FEATURES=(\{[^\n]+\});/.exec(index);
    expect(tiers).not.toBeNull();
    const pro: string[] = JSON.parse(tiers![1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":')).PRO;
    expect(pro.length).toBeGreaterThan(15);
    const keys = [...index.matchAll(/\{id:'[^']+',key:'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) if (k !== 'CORE') expect(pro).toContain(k);
    // The comparison matrix is built from the same sets.
    const rows = [...index.matchAll(/\['[^']+','([A-Z_]+)'\]/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThan(20);
    for (const k of rows) if (k !== 'CORE') expect(pro).toContain(k);
    expect(index).toContain('planMatrix()');
  });

  it('discloses the Android-only app at first mention and in the FAQ', () => {
    expect(index).toContain('One Android app (families on iPhone use the same web portal)');
    expect(index).toContain('<summary>Is there an iPhone app?</summary>');
  });

  it('ships crawlable copy that describes each route before any script runs', () => {
    const ssrOf = (html: string) => html.slice(html.indexOf('<!--ssr:start-->'), html.indexOf('<!--ssr:end-->'));
    for (const file of Object.keys(ROUTES)) {
      const ssr = ssrOf(read(`${file}.html`));
      expect(ssr, `${file}.html has no crawlable block`).toContain('<h1');
      expect(ssr).toContain('Basic ₹30');
      expect(ssr).toContain('href="/pricing"');
    }
    expect(ssrOf(read('pricing.html'))).toContain('per student, per year');
    expect(ssrOf(read('features.html'))).toContain('Four desks, one system');
    expect(ssrOf(read('start.html'))).toContain('build your quote');
    expect(ssrOf(read('pricing.html'))).not.toBe(ssrOf(read('index.html')));
  });

  it('links Blog and Jobs from the main nav and About from the footer', () => {
    expect(index).toContain("{href:'/blog',label:'Blog'}");
    expect(index).toContain("{href:'/jobs',label:'Jobs'}");
    expect(index).toContain('<a href="/about">About Sckools</a>');
  });

  it('labels every lead form field', () => {
    expect(index).toContain('<label for="mf-school">');
    expect(index).toContain('<label for="mf-phone">');
    expect(index).toContain('aria-label="Your phone number"');
  });
});
