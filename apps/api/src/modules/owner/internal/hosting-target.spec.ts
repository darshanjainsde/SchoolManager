import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A school's domain must be attached to the project that SERVES school
 * websites, never to the project this code runs in.
 *
 * On 5 Sept 2026 raffles.sckools.com was attached to skoolos-api and the
 * school's site 404'd in production. The API answers no route for `/`, so every
 * page returned {"code":"NOT_FOUND","message":"Cannot GET /"} as JSON.
 *
 * The attach read VERCEL_PROJECT_ID, which Vercel injects as the id of
 * whichever project is asking — inside the API, that is the API. It had been
 * harmless only because production had no VERCEL_TOKEN, so `configured` was
 * false and the whole path was inert. Adding the token six hours earlier
 * switched it on, and the next attach went to the wrong project.
 *
 * The lesson is not "use the right variable" — it is that a fallback to the
 * wrong-but-present value is worse than no value, because it fails silently.
 */
const src = readFileSync(
  resolve(__dirname, 'hosting-provider.service.ts'),
  'utf8',
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('which project a school domain is attached to', () => {
  it('never builds a Vercel URL from VERCEL_PROJECT_ID', () => {
    // That variable is this service's OWN project. Using it here is the bug.
    expect(code).not.toMatch(/VERCEL_PROJECT_ID/);
  });

  it('addresses the web project explicitly', () => {
    expect(code).toMatch(/webProjectId/);
    expect(code).toMatch(/VERCEL_WEB_PROJECT_ID/);
  });

  it('every projects/ endpoint uses the web project id', () => {
    const urls = [...code.matchAll(/\/v\d+\/projects\/\$\{([^}]+)\}/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(2);
    for (const u of urls) expect(u).toContain('webProjectId');
  });

  it('reports itself unconfigured rather than attaching somewhere wrong', () => {
    // A fallback to VERCEL_PROJECT_ID would re-create the outage silently. An
    // environment holding only the token must fall back to the MANUAL step.
    const gate = code.match(/get configured\(\)[^}]*\}/)?.[0] ?? '';
    expect(gate).toContain('webProjectId');
    expect(gate).not.toContain('VERCEL_PROJECT_ID');
  });
});

describe('the config schema keeps the two ids separate', () => {
  const cfg = readFileSync(
    resolve(__dirname, '../../../../../../packages/config/src/index.ts'),
    'utf8',
  );

  it('declares VERCEL_WEB_PROJECT_ID', () => {
    expect(cfg).toMatch(/VERCEL_WEB_PROJECT_ID:/);
  });

  it('does not default it to VERCEL_PROJECT_ID — that default IS the bug', () => {
    const line = cfg.match(/VERCEL_WEB_PROJECT_ID:[^\n]*/)?.[0] ?? '';
    expect(line).not.toMatch(/default\(/);
    expect(line).not.toMatch(/VERCEL_PROJECT_ID/);
  });
});
