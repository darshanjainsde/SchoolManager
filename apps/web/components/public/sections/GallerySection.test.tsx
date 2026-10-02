import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GallerySection from './GallerySection';
import { galleryGrid, galleryHomeCount, GALLERY_HOME_DEFAULT } from '../site-variants';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE HOMEPAGE IS A TASTE; /gallery IS THE ALBUM.
 *
 * Reported 2026-10-01: a school that has been uploading for a year had every
 * photo on its homepage. Measured — the band rendered `gallery.map(...)` with
 * no cap and the API ships up to 2,000 assets, so 300 photos meant 300 tiles,
 * every band below them pushed thousands of pixels down, the whole album
 * downloaded by anyone scrolling to Contact, and (each tile's reveal being
 * delayed 0.05s) fifteen seconds before the last one finished animating.
 *
 * The same pass fixed something the cap was hiding: this was the ONLY section
 * painting school photos that never went through the optimiser.
 */
const M = 'https://x.supabase.co/storage/v1/object/public/m';
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `${M}/p${i}.jpg`, caption: i === 0 ? 'Sports day' : null }));
const render = (n: number, limit?: number) =>
  renderToStaticMarkup(<GallerySection gallery={photos(n)} schoolName="Raffles" limit={limit} />);
const tiles = (html: string) => (html.match(/_next\/image\?url=/g) ?? []).length;

describe('the homepage band', () => {
  it('shows only its limit, however many the school has uploaded', () => {
    expect(tiles(render(300, 8))).toBe(8);
    expect(tiles(render(9, 8))).toBe(8);
  });

  it('shows everything when the school has fewer than the limit, and offers no pointless link', () => {
    const html = render(5, 8);
    expect(tiles(html)).toBe(5);
    // A school with five photos must not be sent to a page showing the same five.
    expect(html).not.toContain('See all');
  });

  it('names the real total in the way to the rest', () => {
    const html = render(312, 8);
    expect(html).toContain('See all 312 photos');
    expect(html).toContain('href="/gallery"');
  });

  it('on its own page it shows the album — no limit, no link back to itself', () => {
    const html = renderToStaticMarkup(<GallerySection gallery={photos(300)} schoolName="Raffles" onOwnPage />);
    expect(tiles(html)).toBe(300);
    expect(html).not.toContain('See all');
  });
});

describe('every photo goes through the optimiser', () => {
  it('asks for a tile-sized image, not the original', () => {
    const html = render(3, 8);
    // The defect: a school's 4MB phone photo sent whole into a ~264px tile.
    expect(html).not.toContain(`src="${M}/p0.jpg"`);
    expect(html).toContain('_next/image?url=');
    // `&` is escaped in an attribute by renderToStaticMarkup.
    expect(html).toContain('w=640');
  });
});

describe('how many a layout shows', () => {
  it('each arrangement has its own right number', () => {
    // A film strip is a swipeable row and holds more; a mosaic is one lead
    // photo and four around it. One number for all five would be wrong four
    // times.
    expect(GALLERY_HOME_DEFAULT.FILMSTRIP).toBeGreaterThan(GALLERY_HOME_DEFAULT.MOSAIC);
    for (const [layout, n] of Object.entries(GALLERY_HOME_DEFAULT)) {
      expect(galleryHomeCount(null, layout)).toBe(n);
    }
  });

  it('a school’s own choice beats the layout default', () => {
    expect(galleryHomeCount({ gallery: { homeCount: 4 } }, 'FILMSTRIP')).toBe(4);
    // …and an unknown layout still answers with something sane.
    expect(galleryHomeCount(null, 'NOT_A_LAYOUT')).toBe(8);
  });
});

/**
 * THE LAST ROW IS FULL, OR THE BAND LOOKS UNFINISHED.
 *
 * Seen on a school's live homepage, 2026-10-02: the band was set to six
 * photos and the grid is four columns wide, so it painted four across and two
 * underneath with half the row empty — the same hole in Grid, Mosaic and
 * Polaroid (whose own default IS six). The count a school picks is from a
 * small set, so the band can always choose a column count that divides it.
 */
describe('the column count that leaves no ragged row', () => {
  it('divides the chosen count exactly — four when it can, three when four cannot', () => {
    expect(galleryGrid(4, 'GRID')).toEqual({ columns: 4, feature: true });
    expect(galleryGrid(6, 'GRID')).toEqual({ columns: 3, feature: true });
    expect(galleryGrid(8, 'GRID')).toEqual({ columns: 4, feature: true });
    expect(galleryGrid(12, 'GRID')).toEqual({ columns: 4, feature: true });
    // Polaroid's own default is the one that used to break.
    expect(galleryGrid(6, 'POLAROID').columns).toBe(3);
  });

  it('counts the mosaic’s lead photo as the four cells it really occupies', () => {
    // 5 + its 3 extra cells = 8 = two rows of four. This is today's look and it stays.
    expect(galleryGrid(5, 'MOSAIC')).toEqual({ columns: 4, feature: true });
    // 6 + 3 = 9 = three rows of three.
    expect(galleryGrid(6, 'MOSAIC')).toEqual({ columns: 3, feature: true });
    expect(galleryGrid(12, 'MOSAIC')).toEqual({ columns: 3, feature: true });
  });

  it('drops the mosaic’s feature tile when no column count can tile around it', () => {
    // 4 and 8 leave a hole beside a 2×2 lead whichever width is used, so the
    // band shows an even grid instead. A smaller feature beats a gap.
    expect(galleryGrid(4, 'MOSAIC')).toEqual({ columns: 4, feature: false });
    expect(galleryGrid(8, 'MOSAIC')).toEqual({ columns: 4, feature: false });
  });

  it('the band carries its column count, and the album page does not', () => {
    const band = renderToStaticMarkup(
      <GallerySection gallery={photos(40)} schoolName="Raffles" limit={6} layout="GRID" />,
    );
    expect(band).toContain('--ps-gal-cols:3');
    // /gallery shows an album of any length; no count can tile it, so it keeps the four-wide grid.
    const album = renderToStaticMarkup(<GallerySection gallery={photos(10)} schoolName="Raffles" onOwnPage />);
    expect(album).not.toContain('--ps-gal-cols');
  });

  it('tells the stylesheet when the mosaic lead may span', () => {
    const spans = renderToStaticMarkup(
      <GallerySection gallery={photos(40)} schoolName="Raffles" limit={6} layout="MOSAIC" />,
    );
    expect(spans).toContain('data-feature="true"');
    const flat = renderToStaticMarkup(
      <GallerySection gallery={photos(40)} schoolName="Raffles" limit={8} layout="MOSAIC" />,
    );
    expect(flat).toContain('data-feature="false"');
  });
});

describe('the stylesheet reads the band’s column count', () => {
  it('the desktop grid is the variable, not a fixed four', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/public/ps-css.css'), 'utf8');
    expect(css).toMatch(/\.ps-gallery-grid \{[^}]*grid-template-columns: repeat\(var\(--ps-gal-cols, 4\)/);
    // The mosaic's lead only spans when the band said it tiles.
    expect(css).toMatch(/\.ps-v-gallery-mosaic \.ps-gallery-grid\[data-feature="true"\] > button:first-child \{ grid-column: span 2/);
  });
});

