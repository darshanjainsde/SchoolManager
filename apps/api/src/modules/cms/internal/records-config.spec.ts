import { DEFAULT_RECORDS_SITE, formatPublicName, normalizeRecordsConfig } from './records-config';

describe('records site config', () => {
  it('null or garbage is every default, and off', () => {
    expect(normalizeRecordsConfig(null)).toEqual(DEFAULT_RECORDS_SITE);
    expect(normalizeRecordsConfig('x')).toEqual(DEFAULT_RECORDS_SITE);
    expect(normalizeRecordsConfig({ enabled: 'yes', pageLayout: 'NOPE', homeCount: 5 })).toEqual(DEFAULT_RECORDS_SITE);
  });
  it('keeps legal values and drops illegal pinned keys and groups', () => {
    const c = normalizeRecordsConfig({ enabled: true, consentConfirmed: true, nameFormat: 'FULL', pageLayout: 'REGISTER', homeScope: 'PINNED', homeCount: 8, pinned: ['ath-100m|sen|Boys', 'bad key', 'ath-100m|sen|Boys', 'custom:time:1:sack-race|jun|Mixed'], showTopFive: false, groups: ['sen', 'Sen!', 'u14'] });
    expect(c).toEqual({ enabled: true, consentConfirmed: true, nameFormat: 'FULL', pageLayout: 'REGISTER', homeScope: 'PINNED', homeCount: 8, pinned: ['ath-100m|sen|Boys', 'custom:time:1:sack-race|jun|Mixed'], showTopFive: false, groups: ['sen', 'u14'] });
  });
  it('formats a public name', () => {
    expect(formatPublicName('Rohan Iyer', 'FIRST_INITIAL')).toBe('Rohan I.');
    expect(formatPublicName(' Rohan  Kumar Iyer ', 'FIRST_INITIAL')).toBe('Rohan I.');
    expect(formatPublicName('Rohan Iyer', 'FIRST')).toBe('Rohan');
    expect(formatPublicName('Rohan Iyer', 'FULL')).toBe('Rohan Iyer');
    expect(formatPublicName('Zoya', 'FIRST_INITIAL')).toBe('Zoya');
    expect(formatPublicName('', 'FULL')).toBe('');
  });
});
