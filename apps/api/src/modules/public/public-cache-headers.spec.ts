import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A PUBLIC ROUTE THAT IS KEYED BY A HEADER MUST NEVER BE SHARED-CACHEABLE.
 *
 * Every `/public/*` route answers for the school named in `X-Skoolos-Host`;
 * the URL is the same for every school. A `public` / `s-maxage` Cache-Control
 * lets the CDN store the response under that URL — and Vercel's edge keys on
 * the URL plus `Vary: Origin` only, never on a custom request header. Measured
 * on staging 2026-09-27: `GET /public/site` for a host that DOES NOT EXIST
 * came back `x-vercel-cache: HIT` with Raffles' whole website in the body, and
 * every school on that edge wore whichever site was fetched first, for up to
 * eleven minutes. That was reported as "the theme I save never shows — the site
 * is stuck on Holi": it was another school's Holi.
 *
 * The rule: a tenant-keyed public response is `private`. The Next server's own
 * data cache (keyed per host, tagged `site:<host>`, purged on save) is what
 * spares the database; the browser gets `no-cache` so the editor's preview and
 * the birthday wall always ask again and take a 304 when nothing changed.
 */
const dir = __dirname;

it('no public controller sends a shared-cache Cache-Control', () => {
  const offenders: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.controller.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const headers = [...src.matchAll(/Cache-Control['"]\s*,\s*[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]);
    for (const h of headers) {
      if (/s-maxage|\bpublic\b/.test(h)) offenders.push(`${f}: ${h}`);
    }
  }
  expect(offenders).toEqual([]);
});
