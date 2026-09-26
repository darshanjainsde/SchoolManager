// @vitest-environment node
//
// THE BUILD MUST NOT DEPEND ON GOOGLE BEING UP.
//
// `next/font/google` fetches every family at BUILD time. When one of those
// requests hiccups the loader's regex returns null and the deploy dies with
// "An error occurred in next/font — Cannot read properties of null
// (reading '1')". It killed the staging build of PR #122 with no code change
// behind it, and a local build the same afternoon. The files are in the repo
// now; this keeps them there.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'lib/fonts.ts'), 'utf8');

describe('the site fonts are self-hosted', () => {
  it('no module fetches a font at build time', () => {
    // The import, not the prose: the comment above it explains why google is gone.
    expect(src).not.toMatch(/from 'next\/font\/google'/);
    expect(src).toMatch(/from 'next\/font\/local'/);
    // And nowhere else in the app either. Walked in-process rather than
    // shelled out: a `require` in a TS file fails the Next build's own lint.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
        if (readFileSync(full, 'utf8').includes("from 'next/font/google'")) hits.push(full);
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(resolve(process.cwd(), dir));
    expect(hits, 'a module still loads a font from Google at build time').toEqual([]);
  });

  it('every face it declares exists on disk and is a real woff2', () => {
    const paths = [...src.matchAll(/path: '(\.\.\/assets\/fonts\/[^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBe(25);
    for (const p of paths) {
      const file = resolve(process.cwd(), 'lib', p);
      expect(existsSync(file), p).toBe(true);
      // wOF2 magic — a stray text file would pass an existence check and fail the build.
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), p).toBe('wOF2');
      expect(statSync(file).size, p).toBeGreaterThan(4_000);
    }
  });

  it('only Inter preloads — a school on one display face must not pay for eight', () => {
    const blocks = src.split('localFont(').slice(1);
    expect(blocks.length).toBe(8);
    const preloading = blocks.filter((b) => !/preload: false/.test(b.slice(0, b.indexOf('});'))));
    expect(preloading).toHaveLength(1);
    expect(preloading[0]).toMatch(/--f-inter/);
  });

  it('every family still exposes the CSS variable the theme reads', () => {
    for (const v of ['--f-inter', '--f-fraunces', '--f-poppins', '--f-nunito', '--f-playfair', '--f-space-grotesk', '--f-montserrat', '--f-lora']) {
      expect(src, v).toContain(v);
    }
  });
});
