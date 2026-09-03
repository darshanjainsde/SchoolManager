import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CR80, PAPER, PIECES, Sheet, piecePaper, wrapTitle, type PieceKey, type SheetData } from './sheets';

const DATA: SheetData = {
  title: 'Annual Day 2026',
  when: 'Sat, 14 March 2026, 5:00 pm',
  venue: 'School auditorium',
  schoolName: 'Raffles Primary School',
  url: 'raffles.sckools.com/events',
  blurb: 'An evening of music, dance and drama by every class.',
  art: 'annual',
  qr: null,
};

/**
 * SVG has no automatic wrapping, so a title that does not fit simply runs off
 * the page — and nobody sees it until a poster comes out of a printer with
 * half a word on it.
 */
describe('wrapping a title onto a poster', () => {
  it('never exceeds the line budget, however long the title', () => {
    const monster = 'The Inter-house Athletics Championship, Sports Meet and Annual Prize Distribution Ceremony';
    expect(wrapTitle(monster, 180, 20, 3).length).toBeLessThanOrEqual(3);
    expect(wrapTitle(monster, 180, 20, 2).length).toBeLessThanOrEqual(2);
  });

  it('says it truncated rather than cutting a word in half silently', () => {
    const monster = 'The Inter-house Athletics Championship, Sports Meet and Annual Prize Distribution Ceremony';
    expect(wrapTitle(monster, 180, 20, 2).join(' ')).toMatch(/…$/);
  });

  it('keeps every word when the title fits', () => {
    expect(wrapTitle('Annual Day 2026', 180, 20, 3).join(' ')).toBe('Annual Day 2026');
  });

  it('never returns an empty first line for a single long word', () => {
    const [first] = wrapTitle('Supercalifragilisticexpialidocious', 40, 20, 2);
    expect(first.length).toBeGreaterThan(0);
  });
});

/**
 * The viewBox IS the paper, in millimetres — that is what lets the exporter
 * turn a sheet into a 300 dpi file with one multiplication and no guessing.
 * If a sheet's viewBox stops matching its paper, every download is the wrong
 * physical size and a printer rejects it.
 */
describe('a sheet is its paper, in millimetres', () => {
  const cases: [PieceKey, { w: number; h: number }][] = [
    ['poster', PAPER.A3],
    ['handbill', PAPER.A4],
    ['invite', PAPER.A4],
    ['slips', PAPER.A4],
  ];

  it.each(cases)('%s draws at its real page size', (piece, paper) => {
    const { container } = render(<Sheet piece={piece} size="A3" data={DATA} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', `0 0 ${paper.w} ${paper.h}`);
  });

  it('a poster follows the size the school picked', () => {
    const { container } = render(<Sheet piece="poster" size="A4" data={DATA} />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', `0 0 ${PAPER.A4.w} ${PAPER.A4.h}`);
  });

  it('reports the paper the exporter should use', () => {
    expect(piecePaper('poster', 'A3')).toEqual(PAPER.A3);
    expect(piecePaper('poster', 'A4')).toEqual(PAPER.A4);
    // Everything else is imposed onto A4 whatever the size control says.
    expect(piecePaper('invite', 'A3')).toEqual(PAPER.A4);
    expect(piecePaper('slips', 'A3')).toEqual(PAPER.A4);
  });
});

describe('what fits on a sheet', () => {
  it('puts four handbills on one A4, with cut lines', () => {
    const { container } = render(<Sheet piece="handbill" size="A4" data={DATA} />);
    // Four titles, one per bill.
    expect(container.querySelectorAll('text')).not.toHaveLength(0);
    expect([...container.querySelectorAll('text')].filter((t) => t.textContent === DATA.title)).toHaveLength(4);
    expect(container.querySelectorAll('line')).toHaveLength(2);
  });

  it('puts ten invitation cards on one A4 at true CR80 size', () => {
    const { container } = render(<Sheet piece="invite" size="A4" data={DATA} />);
    const outlines = [...container.querySelectorAll('rect')].filter(
      (r) => r.getAttribute('width') === String(CR80.w) && r.getAttribute('height') === String(CR80.h),
    );
    expect(outlines.length).toBeGreaterThanOrEqual(10);
  });

  it('puts ten slips on one A4', () => {
    const { container } = render(<Sheet piece="slips" size="A4" data={DATA} />);
    expect([...container.querySelectorAll('text')].filter((t) => t.textContent === DATA.title)).toHaveLength(10);
  });

  /** A poster with no QR yet is still a poster — it prints the URL underneath. */
  it('survives the QR not being ready', () => {
    const { container } = render(<Sheet piece="poster" size="A3" data={{ ...DATA, qr: null }} />);
    expect(container.querySelector('image')).toBeNull();
    expect([...container.querySelectorAll('text')].some((t) => t.textContent === DATA.url)).toBe(true);
  });

  it('names every piece and its paper for the picker', () => {
    for (const p of Object.values(PIECES)) {
      expect(p.name).toBeTruthy();
      expect(p.sizeLabel).toBeTruthy();
      expect(p.sizes.length).toBeGreaterThan(0);
    }
  });
});
