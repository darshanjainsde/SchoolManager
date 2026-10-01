import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GallerySection from './GallerySection';
import { galleryHomeCount, GALLERY_HOME_DEFAULT } from '../site-variants';

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
