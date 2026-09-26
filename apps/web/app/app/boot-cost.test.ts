// @vitest-environment node
//
// WHAT THE CONSOLE DOES BEFORE IT CAN SHOW YOU ANYTHING.
//
// Measured on the owner's own signed-in console, `/app` on staging: the page,
// its stylesheets and its JavaScript were all delivered by 606 ms — and the
// screen was still not populated at 2,930 ms. Everything in between was the
// boot: one gating call, then a burst of nine.
//
// The burst is what costs, and not for the reason it looks. Firing ten
// requests at once makes the platform start extra serverless instances, and an
// instance that has to cold-start takes about two seconds. Same endpoint, same
// session, minutes apart: `/manage/subjects` took 2,071 ms inside the burst and
// 209 ms when asked on its own. Six of those nine requests existed only to
// answer `length > 0` for a setup checklist.
//
// So this file guards the shape, not a number: the landing screen asks for
// what it draws, and nothing downloads a collection to find out whether it is
// empty.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read the CODE, not the prose.
 *
 * Both of these files now carry a comment explaining the very thing this file
 * forbids — the measurement naming `/manage/subjects`, the note that this hook
 * used to be a plain `useState`. A guard that greps the raw text fails on the
 * documentation of its own fix, which teaches the next person to delete the
 * explanation rather than keep the rule.
 */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (p: string) => strip(readFileSync(resolve(process.cwd(), p), 'utf8'));

describe('the console landing screen', () => {
  const home = read('app/app/page.tsx');

  it('does not download a collection to decide whether it is empty', () => {
    // Each of these was a whole table fetched for one bit. /manage/students is
    // the worst of them: the repo's own measurement is 227 kB per 500 children.
    for (const url of ['/manage/years', '/manage/periods', '/manage/subjects', '/manage/teachers', '/manage/students']) {
      expect(home).not.toContain(url);
    }
  });

  it('asks for at most two things on mount', () => {
    // The pulse (which now carries the setup ticks) and the bell. More than
    // this and the cold-start lottery comes back.
    const mounts = home.match(/useQuery\(\{/g) ?? [];
    expect(mounts.length).toBeLessThanOrEqual(2);
  });

  it('reads the setup ticks off the pulse, and hides them when the API is older', () => {
    expect(home).toMatch(/pulseQuery\.data\?\.setup \?\? null/);
    // `?? false` rather than `?? true`: during a deploy the web is live before
    // the API, and six red crosses on a school that finished setting up months
    // ago would be worse than showing nothing. The card only renders when a
    // step is outstanding, so a null `setup` hides it.
    expect(home).toMatch(/done: setup\?\.\w+ \?\? false/);
  });
});

describe('the host hook', () => {
  const hook = read('components/use-host.ts');

  it('remembers the host across mounts instead of re-deriving it every time', () => {
    // 174 call sites in 149 files. While every one owned a private useState +
    // useEffect, every newly mounted screen rendered once with host undefined —
    // so every `enabled: !!host` query was off — then committed, ran its
    // effect, and only then re-rendered and asked for data. A full
    // render-commit-effect cycle of dead time before each navigation's first
    // byte was requested.
    expect(hook).toMatch(/^let clientHost: string \| undefined;$/m);
    expect(hook).toMatch(/useState<string \| undefined>\(clientHost\)/);
  });

  it('still returns undefined on the very first render, so hydration is untouched', () => {
    // The console shells are statically prerendered. If the first client render
    // disagreed with the server's HTML, React would throw the tree away — which
    // is why this cannot simply read window.location.host during render.
    expect(hook).not.toMatch(/useState<[^>]*>\([^)]*window\.location/);
    expect(hook).toMatch(/useEffect\(\(\) => \{/);
  });
});
