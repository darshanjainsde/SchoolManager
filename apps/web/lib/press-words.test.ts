import { describe, it, expect } from 'vitest';
import { classInWords, dateInWords } from './press';

describe('dateInWords — Annexure field 6 prints the DOB in words', () => {
  it.each([
    ['2014-03-12', 'Twelfth March Two Thousand Fourteen'],
    ['2013-06-02', 'Second June Two Thousand Thirteen'],
    ['2010-08-21', 'Twenty First August Two Thousand Ten'],
    ['1999-12-30', 'Thirtieth December One Thousand Nine Hundred Ninety Nine'],
    ['2015-05-20', 'Twentieth May Two Thousand Fifteen'],
  ])('%s → %s', (iso, words) => {
    expect(dateInWords(iso)).toBe(words);
  });

  it('answers nothing for garbage — a blank line beats an invented date', () => {
    expect(dateInWords('not-a-date')).toBe('');
  });
});

describe('classInWords — field 7/11 print the class in words', () => {
  it.each([
    ['VII', 'Seventh'], ['XII', 'Twelfth'], ['I', 'First'],
    ['Class 8', 'Eighth'], ['10', 'Tenth'],
  ])('%s → %s', (label, words) => {
    expect(classInWords(label)).toBe(words);
  });

  it('an unparseable label prints as-is elsewhere and adds no words here', () => {
    expect(classInWords('Nursery-A')).toBe('');
    expect(classInWords(null)).toBe('');
  });
});
