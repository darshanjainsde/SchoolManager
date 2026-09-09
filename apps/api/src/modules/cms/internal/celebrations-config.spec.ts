import { normalizeCelebrationsConfig, DEFAULT_CELEBRATIONS } from './celebrations-config';

describe('normalizeCelebrationsConfig', () => {
  it('null is every default: families only, no photos, first name and an initial', () => {
    expect(normalizeCelebrationsConfig(null)).toEqual(DEFAULT_CELEBRATIONS);
    expect(normalizeCelebrationsConfig(undefined)).toEqual(DEFAULT_CELEBRATIONS);
    expect(normalizeCelebrationsConfig('junk')).toEqual(DEFAULT_CELEBRATIONS);
    expect(DEFAULT_CELEBRATIONS.audience).toBe('FAMILIES');
    expect(DEFAULT_CELEBRATIONS.showPhotos).toBe(false);
    expect(DEFAULT_CELEBRATIONS.nameFormat).toBe('FIRST_INITIAL');
  });

  it('drops unknown values and keeps known ones; the wish line is capped', () => {
    const c = normalizeCelebrationsConfig({
      window: 'YEAR',
      page: 'NOTICE_BOARD',
      teaser: 'BALLOONS',
      showClass: 'yes',
      wishLine: 'x'.repeat(300),
    });
    expect(c.window).toBe('WEEK');
    expect(c.page).toBe('NOTICE_BOARD');
    expect(c.teaser).toBe('CAKE_BADGE');
    expect(c.showClass).toBe(true);
    expect(c.wishLine).toHaveLength(160);
  });

  it('PUBLIC or BOTH without consentConfirmed falls back to FAMILIES', () => {
    expect(normalizeCelebrationsConfig({ audience: 'PUBLIC' }).audience).toBe('FAMILIES');
    expect(normalizeCelebrationsConfig({ audience: 'BOTH' }).audience).toBe('FAMILIES');
    expect(normalizeCelebrationsConfig({ audience: 'PUBLIC', consentConfirmed: true }).audience).toBe('PUBLIC');
    expect(normalizeCelebrationsConfig({ audience: 'BOTH', consentConfirmed: true }).audience).toBe('BOTH');
  });

  it('manual entries are validated, capped, and sorted by date', () => {
    const c = normalizeCelebrationsConfig({
      manual: [
        { name: 'B', day: 31, month: 2 },
        { name: 'Zoya K', day: 10, month: 9, classLabel: '1A' },
        { name: 'A', day: 5, month: 1, classLabel: '  2A  ' },
        { name: '', day: 1, month: 1 },
        { name: 'C', day: 29, month: 2 },
        'junk',
      ],
    });
    expect(c.manual).toEqual([
      { name: 'A', day: 5, month: 1, classLabel: '2A' },
      { name: 'C', day: 29, month: 2, classLabel: null },
      { name: 'Zoya K', day: 10, month: 9, classLabel: '1A' },
    ]);
  });

  it('caps the manual list at 500', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `N${i}`, day: 1, month: 1 }));
    expect(normalizeCelebrationsConfig({ manual: many }).manual).toHaveLength(500);
  });
});
