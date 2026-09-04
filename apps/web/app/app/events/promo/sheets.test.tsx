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
  cover: 'full',
  border: 'none',
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

describe('cover treatment and borders', () => {
  it('drops the picture entirely on "words only"', () => {
    const { container } = render(<Sheet piece="poster" size="A3" data={{ ...DATA, cover: 'none' }} />);
    // The drawn art's ground rect is the full art width; with no cover the only
    // full-width rect left is the white page itself.
    const grounds = [...container.querySelectorAll('rect')].filter((r) => r.getAttribute('width') === String(PAPER.A3.w));
    expect(grounds).toHaveLength(1);
  });

  it('gives a band less of the sheet than a full cover', () => {
    const heightOfCover = (cover: 'full' | 'band') => {
      const { container } = render(<Sheet piece="poster" size="A3" data={{ ...DATA, cover }} />);
      const rects = [...container.querySelectorAll('rect')].filter((r) => r.getAttribute('width') === String(PAPER.A3.w));
      // [0] is the page, [1] is the art's ground.
      return Number(rects[1]?.getAttribute('height') ?? 0);
    };
    expect(heightOfCover('band')).toBeLessThan(heightOfCover('full'));
    expect(heightOfCover('band')).toBeGreaterThan(0);
  });

  it('draws nothing at all for the "none" border', () => {
    const plain = render(<Sheet piece="poster" size="A3" data={{ ...DATA, border: 'none' }} />);
    const framed = render(<Sheet piece="poster" size="A3" data={{ ...DATA, border: 'double' }} />);
    expect(framed.container.querySelectorAll('rect').length).toBeGreaterThan(plain.container.querySelectorAll('rect').length);
  });

  /**
   * The border is inset from the trim. A domestic printer cannot reach the
   * paper's edge, so a frame drawn ON the edge prints clipped down one side
   * and not the other — which reads as a broken template, not a margin.
   */
  it('insets the border from the paper edge', () => {
    const { container } = render(<Sheet piece="poster" size="A3" data={{ ...DATA, border: 'hairline' }} />);
    const frame = [...container.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === 'none');
    expect(frame).toBeTruthy();
    expect(Number(frame!.getAttribute('x'))).toBeGreaterThan(0);
    expect(Number(frame!.getAttribute('width'))).toBeLessThan(PAPER.A3.w);
  });

  it('uses the photograph when one is inlined, and the artwork when it is not', () => {
    const withPhoto = render(<Sheet piece="poster" size="A3" data={{ ...DATA, photo: 'data:image/png;base64,AAA' }} />);
    expect(withPhoto.container.querySelector('image')).toBeTruthy();
    const withArt = render(<Sheet piece="poster" size="A3" data={{ ...DATA, photo: null }} />);
    expect(withArt.container.querySelector('image')).toBeNull();
  });

  /** A tall photo is cropped; which band survives is the school's choice. */
  it.each([
    ['top', 'xMidYMin slice'],
    ['middle', 'xMidYMid slice'],
    ['bottom', 'xMidYMax slice'],
  ] as const)('keeps the %s of a tall photo', (focus, expected) => {
    const { container } = render(
      <Sheet piece="poster" size="A3" data={{ ...DATA, photo: 'data:image/png;base64,AAA', focus }} />,
    );
    expect(container.querySelector('image')).toHaveAttribute('preserveAspectRatio', expected);
  });
});
