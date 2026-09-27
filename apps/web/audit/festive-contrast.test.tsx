/**
 * MEASURES every FULL festive palette with the repo's own WCAG helpers.
 * Prints a table; asserts nothing yet — this run is the evidence for the pitch.
 */
import { describe, it } from 'vitest';
import { contrastRatio, labelOn, mix } from '@/components/public/site-utils';
import { FESTIVALS } from '@/components/public/site-variants';

// color-mix(in srgb, A p%, B) — the same arithmetic the stylesheet uses.
const cm = (a: string, pct: number, b: string) => mix(b, a, pct / 100);
const SLATE = { 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b' };
const r = (a: string, b: string) => contrastRatio(a, b).toFixed(2);
const flag = (v: number, min = 4.5) => (v >= min ? ' ' : '✗');

describe('festive contrast audit', () => {
  it('prints the numbers', () => {
    const rows: string[] = [];
    rows.push('festival     | surface | ink/paper | body/paper | body/card | ps1-on/ps1 | ps2-on/ps2 | ps2/paper | ribbon ink/bg | slate400/tblhead | slate500/paper');
    for (const f of FESTIVALS) {
      const paper = f.fullSurface?.paper ?? '#f7f5ef';
      const ink = f.fullSurface?.ink ?? mix(f.full.ps1, '#14261d', 0.55);
      const dark = !!f.fullSurface;
      const body = dark ? cm(ink, 70, paper) : SLATE[500];
      const card = dark ? cm(paper, 82, '#fff') : '#ffffff';
      const ribbonBg = cm(f.full.ps2, 24, paper);
      const tblHead = cm(f.full.ps1, 5, '#fff'); // fest-dark does NOT remap this white fill
      const c = (a: string, b: string, min = 4.5) => `${r(a, b)}${flag(contrastRatio(a, b), min)}`;
      rows.push(
        [
          f.value.padEnd(12),
          (dark ? 'DARK' : 'light').padEnd(7),
          c(ink, paper).padEnd(9),
          c(body, paper).padEnd(10),
          c(body, card).padEnd(9),
          c(labelOn(f.full.ps1), f.full.ps1).padEnd(10),
          c(labelOn(f.full.ps2), f.full.ps2).padEnd(10),
          c(f.full.ps2, paper, 3).padEnd(9),
          c(ink, ribbonBg).padEnd(13),
          c(SLATE[400], tblHead).padEnd(16),
          c(SLATE[500], paper),
        ].join(' | '),
      );
    }
    // Default (no festival) for reference.
    const defInk = mix('#2f6b4f', '#14261d', 0.55);
    rows.push(`${'(none)'.padEnd(12)} | light   | ${r(defInk, '#f7f5ef')}  | ${r(SLATE[500], '#f7f5ef')}  | ${r(SLATE[500], '#fff')}`);
    console.log('\n' + rows.join('\n') + '\n');
  });
});
