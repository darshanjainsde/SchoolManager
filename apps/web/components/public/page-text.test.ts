import { describe, it, expect } from 'vitest';
import { parseInline, parseRichText, hasMarks } from './page-text';

/**
 * The marks a school types, parsed on the way OUT so nothing in the database
 * is ever markup. The tests that matter most are the ones about what is NOT
 * supported: a refused link keeps its words, and nothing ever becomes HTML.
 */
describe('inline marks', () => {
  it('reads bold, italic and a link', () => {
    expect(parseInline('a **b** c')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
    expect(parseInline('an *aside*')).toEqual([{ text: 'an ' }, { text: 'aside', italic: true }]);
    expect(parseInline('ring [the office](/contact) now')).toEqual([
      { text: 'ring ' },
      { text: 'the office', href: '/contact' },
      { text: ' now' },
    ]);
  });

  it('reads bold before italic, so ** is never a stray *', () => {
    expect(parseInline('**both**')).toEqual([{ text: 'both', bold: true }]);
  });

  it('leaves an unmatched marker as a literal character', () => {
    // A school writing "5 * 3 buses" must get "5 * 3 buses".
    expect(parseInline('5 * 3 buses')).toEqual([{ text: '5 * 3 buses' }]);
    expect(parseInline('a ** b')).toEqual([{ text: 'a ** b' }]);
  });

  it('keeps the words of a link it refuses', () => {
    // Losing the sentence would be worse than losing the link.
    expect(parseInline('[tap here](javascript:alert)')).toEqual([{ text: 'tap here' }]);
    for (const bad of ['javascript:alert', 'data:text/html,x', 'vbscript:x', 'JavaScript:alert']) {
      const spans = parseInline(`a [tap](${bad}) b`);
      expect(spans.some((s) => s.href)).toBe(false);
      expect(JSON.stringify(spans).toLowerCase()).not.toContain('javascript');
      expect(JSON.stringify(spans).toLowerCase()).not.toContain('data:text');
    }
  });

  it('allows the addresses a school really uses', () => {
    for (const href of ['/contact', '#fees', 'https://x.test/a', 'mailto:office@x.test', 'tel:+919876543210']) {
      expect(parseInline(`[go](${href})`)[0].href).toBe(href);
    }
  });
});

describe('lines', () => {
  it('turns consecutive bullets into one list', () => {
    expect(parseRichText('- one\n- two\n- three')).toEqual([
      { kind: 'ul', items: [[{ text: 'one' }], [{ text: 'two' }], [{ text: 'three' }]] },
    ]);
  });

  it('numbers too, and a second list starts when the kind changes', () => {
    const out = parseRichText('1. first\n2. second\n- a bullet');
    expect(out.map((l) => l.kind)).toEqual(['ol', 'ul']);
  });

  it('keeps single newlines inside a paragraph, as typing an address does', () => {
    const out = parseRichText('14 Cunningham Road\nBengaluru 560052');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('p');
    expect((out[0] as { spans: { text: string }[] }).spans[0].text).toBe('14 Cunningham Road\nBengaluru 560052');
  });

  it('a blank line ends a paragraph', () => {
    expect(parseRichText('one\n\ntwo').map((l) => l.kind)).toEqual(['p', 'p']);
  });

  it('a list between two paragraphs keeps all three', () => {
    const out = parseRichText('Before.\n- a\n- b\nAfter.');
    expect(out.map((l) => l.kind)).toEqual(['p', 'ul', 'p']);
  });

  it('plain text with no marks is one paragraph and nothing else', () => {
    expect(parseRichText('Just a sentence.')).toEqual([{ kind: 'p', spans: [{ text: 'Just a sentence.' }] }]);
  });

  it('empty text produces nothing to render', () => {
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText('\n\n  \n')).toEqual([]);
  });
});

describe('hasMarks', () => {
  it('knows when the editor needs to explain itself', () => {
    expect(hasMarks('plain words')).toBe(false);
    expect(hasMarks('a **bold** word')).toBe(true);
    expect(hasMarks('- a bullet')).toBe(true);
    expect(hasMarks('1. a number')).toBe(true);
  });
});
