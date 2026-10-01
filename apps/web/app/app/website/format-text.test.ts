import { describe, expect, it } from 'vitest';
import { parseRichText } from '@/components/public/page-text';
import { applyFormat } from './format-text';

/** Apply to the whole string, or to the [start, end) given. */
const fmt = (v: string, action: Parameters<typeof applyFormat>[3], s = 0, e = v.length) =>
  applyFormat(v, s, e, action);

describe('bold and italic', () => {
  it('wraps the selection and keeps it selected', () => {
    const r = fmt('Bring the birth certificate', 'bold', 10, 27);
    expect(r.value).toBe('Bring the **birth certificate**');
    expect(r.value.slice(r.start, r.end)).toBe('birth certificate');
  });

  it('keeps spaces outside the marks, where the parser needs them', () => {
    expect(fmt('a word b', 'bold', 1, 7).value).toBe('a **word** b');
  });

  it('toggles back off, from inside or outside the marks', () => {
    const on = fmt('fees', 'bold');
    expect(on.value).toBe('**fees**');
    expect(fmt(on.value, 'bold', on.start, on.end).value).toBe('fees');
    expect(fmt(on.value, 'bold').value).toBe('fees');
  });

  it('with nothing selected, opens a pair with the caret inside', () => {
    const r = fmt('ab', 'italic', 1, 1);
    expect(r.value).toBe('a**b');
    expect(r.start).toBe(2);
  });

  it('produces what the public site renders as bold', () => {
    const lines = parseRichText(fmt('Visit us', 'bold').value);
    expect(lines).toEqual([{ kind: 'p', spans: [{ text: 'Visit us', bold: true }] }]);
  });
});

describe('lists', () => {
  const docs = 'Birth certificate\nTwo photos\nLast report card';

  it('bullets every selected line, and the site renders one list', () => {
    const r = fmt(docs, 'bullets', 3, 20);
    expect(r.value).toBe('- Birth certificate\n- Two photos\nLast report card');
    expect(parseRichText(r.value)[0]).toMatchObject({ kind: 'ul', items: [[{ text: 'Birth certificate' }], [{ text: 'Two photos' }]] });
  });

  it('numbers lines in order', () => {
    expect(fmt(docs, 'numbers').value).toBe('1. Birth certificate\n2. Two photos\n3. Last report card');
  });

  it('toggles off, and switches bullets ↔ numbers', () => {
    const bulleted = fmt(docs, 'bullets').value;
    expect(fmt(bulleted, 'bullets').value).toBe(docs);
    expect(fmt(bulleted, 'numbers').value).toBe('1. Birth certificate\n2. Two photos\n3. Last report card');
  });

  it('leaves a heading line above the list alone', () => {
    const v = 'Documents to bring:\nBirth certificate\nTwo photos';
    const r = fmt(v, 'bullets', v.indexOf('Birth'), v.length);
    expect(r.value).toBe('Documents to bring:\n- Birth certificate\n- Two photos');
    expect(parseRichText(r.value).map((l) => l.kind)).toEqual(['p', 'ul']);
  });

  it('on an empty line, starts a bullet with the caret after it', () => {
    const r = fmt('Intro\n', 'bullets', 6, 6);
    expect(r.value).toBe('Intro\n- ');
    expect(r.start).toBe(8);
  });

  it('does not prefix the blank line that separates two blocks', () => {
    expect(fmt('a\n\nb', 'bullets').value).toBe('- a\n\n- b');
  });
});
