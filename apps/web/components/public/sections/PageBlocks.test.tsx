import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PageBlocks from './PageBlocks';
import { normalizePageBlocks, type PageBlock } from '../site-variants';

/**
 * A custom page's blocks. The set is closed on purpose — what 2026-10 added is
 * OPTIONS, and the rule every one of them follows is: absent means the block
 * renders exactly as it did before any of this existed.
 */
const M = 'https://x.supabase.co/storage/v1/object/public/m';
const html = (blocks: PageBlock[]) => renderToStaticMarkup(<PageBlocks blocks={blocks} />);

describe('nothing changes for a page written before the options existed', () => {
  it('a heading, a paragraph and a button render as they always did', () => {
    const out = html([
      { t: 'h', text: 'Transport' },
      { t: 'p', text: 'Fourteen routes.' },
      { t: 'cta', label: 'Enquire', href: '/contact' },
    ]);
    expect(out).toContain('<h2');
    expect(out).toContain('Transport');
    expect(out).toContain('Fourteen routes.');
    expect(out).toContain('href="/contact"');
    // No alignment class, no ghost button: the defaults are the old look.
    expect(out).not.toContain('ps-pg-center');
    expect(out).not.toContain('ps-cta-ghost');
  });

  it('an empty page still says something', () => {
    expect(html([])).toContain('This page is being written');
  });
});

describe('alignment', () => {
  it('centres a heading, a paragraph and a button', () => {
    for (const b of [
      { t: 'h', text: 'A', align: 'CENTER' },
      { t: 'p', text: 'A', align: 'CENTER' },
      { t: 'cta', label: 'A', href: null, align: 'CENTER' },
    ] as PageBlock[]) {
      expect(html([b])).toContain('ps-pg-center');
    }
    expect(html([{ t: 'h', text: 'A', align: 'RIGHT' }])).toContain('ps-pg-right');
  });

  it('is never stored as LEFT, because left is the absence of a choice', () => {
    expect(normalizePageBlocks([{ t: 'h', text: 'A', align: 'LEFT' }])).toEqual([{ t: 'h', text: 'A' }]);
    expect(normalizePageBlocks([{ t: 'h', text: 'A', align: 'SIDEWAYS' }])).toEqual([{ t: 'h', text: 'A' }]);
  });
});

describe('a picture', () => {
  it('goes through the optimiser — the bug this release fixed', () => {
    const out = html([{ t: 'img', url: `${M}/bus.jpg`, caption: null }]);
    // It used to send a school's 4MB phone photo whole.
    expect(out).not.toContain(`src="${M}/bus.jpg"`);
    expect(out).toContain('_next/image?url=');
  });

  it('can show the whole picture instead of a cropped band', () => {
    const crop = html([{ t: 'img', url: `${M}/poster.jpg`, caption: null }]);
    const whole = html([{ t: 'img', url: `${M}/poster.jpg`, caption: null, fit: 'CONTAIN' }]);
    expect(crop).toContain('object-cover');
    expect(whole).toContain('ps-pg-img-contain');
    expect(whole).not.toContain('object-cover');
  });

  it('runs in the column, the page, or the full bleed — and asks for a bigger file as it grows', () => {
    expect(html([{ t: 'img', url: `${M}/a.jpg`, caption: null, width: 'COLUMN' }])).toContain('ps-pg-img-column');
    expect(html([{ t: 'img', url: `${M}/a.jpg`, caption: null, width: 'FULL' }])).toContain('ps-pg-img-full');
    expect(html([{ t: 'img', url: `${M}/a.jpg`, caption: null, width: 'FULL' }])).toContain('w=1920');
    expect(html([{ t: 'img', url: `${M}/a.jpg`, caption: null, width: 'COLUMN' }])).toContain('w=828');
  });
});

describe('the five arrangements a school asked for', () => {
  it('a divider in three styles, and none of them is content', () => {
    expect(html([{ t: 'divider' }])).toContain('ps-pg-div-rule');
    expect(html([{ t: 'divider', style: 'DOTS' }])).toContain('ps-pg-div-dots');
    // It is decoration: a screen reader must not announce it.
    expect(html([{ t: 'divider' }])).toContain('aria-hidden="true"');
  });

  it('a quote, with and without attribution', () => {
    const out = html([{ t: 'quote', text: 'Every child is known here.', by: 'Dr Aadhya Venkataraghavan' }]);
    expect(out).toContain('<blockquote');
    expect(out).toContain('Every child is known here.');
    expect(out).toContain('Dr Aadhya Venkataraghavan');
    expect(html([{ t: 'quote', text: 'Alone.', by: null }])).not.toContain('<figcaption');
  });

  it('a callout in three tones', () => {
    expect(html([{ t: 'callout', text: 'Note this.' }])).toContain('ps-pg-callout-note');
    expect(html([{ t: 'callout', text: 'Careful.', tone: 'WARN' }])).toContain('ps-pg-callout-warn');
    expect(html([{ t: 'callout', text: 'Good.', tone: 'GOOD' }])).toContain('ps-pg-callout-good');
  });

  it('a file opens in a new tab and says what it is', () => {
    const out = html([{ t: 'file', url: 'https://x.test/a.pdf', label: 'Route map', note: 'PDF · 1.2 MB' }]);
    expect(out).toContain('href="https://x.test/a.pdf"');
    expect(out).toContain('Route map');
    expect(out).toContain('PDF · 1.2 MB');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('a table scrolls ITSELF, so a wide fee table never scrolls the page', () => {
    const out = html([{ t: 'table', rows: [['Route', 'Fee'], ['1', '₹18,000']], header: true }]);
    // The rule the whole site is held to.
    expect(out).toContain('ps-pg-tablewrap');
    expect(out).toContain('<th');
    expect(out).toContain('Route');
    expect(out).toContain('₹18,000');
    // Without a header the first row is data, not a column name.
    expect(html([{ t: 'table', rows: [['a', 'b']] }])).not.toContain('<th');
  });
});

describe('the marks a school types', () => {
  it('become real elements, and a list is a list', () => {
    const out = html([{ t: 'p', text: 'A **bold** word and [a link](/contact).\n- one\n- two' }]);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('href="/contact"');
    expect(out).toContain('<ul');
    expect(out).toContain('<li>one</li>');
  });

  it('never become HTML, whatever is typed', () => {
    const out = html([{ t: 'p', text: '<script>alert(1)</script> and <b>not bold</b>' }]);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>not bold</b>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('what the normalizer refuses', () => {
  it('drops a table of nothing and a file with no address', () => {
    expect(normalizePageBlocks([{ t: 'table', rows: [['', '']] }])).toEqual([]);
    expect(normalizePageBlocks([{ t: 'file', url: 'javascript:x', label: 'Tap' }])).toEqual([]);
    expect(normalizePageBlocks([{ t: 'file', url: 'https://x.test/a.pdf', label: '  ' }])).toEqual([]);
  });

  it('caps a table rather than letting a page become a spreadsheet', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`r${i}`, 'x', 'y', 'z', 'a', 'b', 'c', 'd']);
    const out = normalizePageBlocks([{ t: 'table', rows }]) as Extract<PageBlock, { t: 'table' }>[];
    expect(out[0].rows).toHaveLength(30);
    expect(out[0].rows[0]).toHaveLength(6);
  });
});
