// @vitest-environment node
//
// WHAT THE BROWSER IS MADE TO DOWNLOAD.
//
// Two things reached every visitor that nothing on their screen used, and
// neither was visible in any test, any review or any page: the bundler is the
// only witness, and it never spoke up.
//
//  1. THE FESTIVE SCENES. Twenty-two festivals' artwork — every diya, every
//     rangoli, the whole drawing kit — sat behind `HeroSection`'s 'use client'
//     line, so every parent opening a school's website downloaded all of them
//     to draw at most one, on at most a handful of days a year. The scenes are
//     static SVG with no state, so they belong on the SERVER: PublicSite draws
//     the dress and hands it to the hero as a slot. That alone took every
//     school site page from 190 kB to 143 kB of first-load JavaScript.
//
//  2. THE SPORTS RULE BOOK. `@skoolos/types` is a barrel, and the sports
//     catalogue inside it carries the full written rules of every sport — 67 kB
//     of source. Without `"sideEffects": false` the bundler must assume
//     importing ANY type from that barrel might matter, so the rule book shipped
//     to 39 routes: the blog, the Complaint Box, the teacher record, the
//     marketing homepage. With the flag it reaches the six sports screens that
//     show it, and 33 other routes lost 24-27 kB each.
//
// Both are one-line mistakes to make again, and neither shows up on screen.
// This file is the witness.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();

/** Every source file under a directory, recursively, excluding tests. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)) out.push(p);
    }
  };
  walk(resolve(root, dir));
  return out;
}

const isClient = (src: string) => /^\s*['"]use client['"]/.test(src);

describe('the festive scenes stay on the server', () => {
  it('no client component imports the scenes, the drawing kit, or the layer that registers them', () => {
    const offenders = sources('components')
      .concat(sources('app'))
      .filter((p) => {
        const src = readFileSync(p, 'utf8');
        if (!isClient(src)) return false;
        // Any import path ending in these, however it is spelled — a sibling
        // in the same folder writes './FestiveLayer', which a path-prefixed
        // pattern would miss and pass by accident.
        return /from\s+['"][^'"]*\/(scenes|primitives|scene-variants|FestiveLayer)['"]/.test(src);
      })
      .map((p) => p.replace(`${root}/`, ''));
    // A client module that imports FestiveLayer pulls all 22 festivals into
    // the browser's download. Draw the scene in a server component and pass
    // it down as a ReactNode slot, the way PublicSite passes `dress`.
    expect(offenders).toEqual([]);
  });

  it('the hero takes the dress as a slot rather than drawing it itself', () => {
    const hero = readFileSync(resolve(root, 'components/public/sections/HeroSection.tsx'), 'utf8');
    expect(isClient(hero)).toBe(true);
    expect(hero).not.toMatch(/FestiveDress/);
    expect(hero).toMatch(/dress\?: ReactNode/);
    const site = readFileSync(resolve(root, 'components/public/PublicSite.tsx'), 'utf8');
    expect(isClient(site)).toBe(false);
    expect(site).toMatch(/dress=\{<FestiveDress/);
  });
});

describe('@skoolos/types can be tree-shaken', () => {
  it('declares itself free of import-time side effects, so a barrel import does not drag the whole package', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, '../../packages/types/package.json'), 'utf8'));
    // Without this the sports rule book rides along with every `import type`
    // from '@skoolos/types' — measured at 76 kB on 39 routes.
    expect(pkg.sideEffects).toBe(false);
  });

  it('nothing outside the sports folder reaches into the catalogue, so dropping it is always safe', () => {
    const typesSrc = resolve(root, '../../packages/types/src');
    const offenders = sources('../../packages/types/src')
      .filter((p) => !p.includes(`${typesSrc}/sports/`))
      .filter((p) => !p.endsWith('/index.ts'))
      .filter((p) => /sports\/catalogue/.test(readFileSync(p, 'utf8')))
      .map((p) => p.replace(`${root}/`, ''));
    expect(offenders).toEqual([]);
  });
});
