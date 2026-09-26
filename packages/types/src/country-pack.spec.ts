import { COUNTRIES, COUNTRY_CODES, DEFAULT_COUNTRY, countryName } from './countries';
import { COUNTRY_PACKS, DEFAULT_PACK, countryPack, hasOwnPack } from './country-pack';

describe('the country list', () => {
  it('is a real ISO list — India is in it, codes are unique, names are English', () => {
    expect(COUNTRIES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(countryName('IN')).toBe('India');
    expect(COUNTRY_CODES.has('IN')).toBe(true);
    expect(COUNTRY_CODES.has('EU')).toBe(false); // supranational codes are not countries a school can be in
  });
  it('defaults to India, the only country fully built out', () => {
    expect(DEFAULT_COUNTRY).toBe('IN');
    expect(countryName(undefined)).toBe('');
  });
});

describe('the country switch', () => {
  it('India has its own pack and it is the default', () => {
    expect(hasOwnPack('IN')).toBe(true);
    expect(countryPack('IN')).toBe(COUNTRY_PACKS.IN);
    expect(countryPack('IN').inheritedFrom).toBeUndefined();
    expect(DEFAULT_PACK.code).toBe('IN');
  });
  it('every other country inherits India TODAY — and says so, so a screen can tell the owner', () => {
    for (const code of ['AE', 'GB', 'US', 'NP', 'SG']) {
      const p = countryPack(code);
      expect(p.code).toBe(code);
      expect(p.inheritedFrom).toBe('IN');
      expect(p.festivals).toBe('SHARED');
      expect(p.timezone).toBe(DEFAULT_PACK.timezone);
      expect(hasOwnPack(code)).toBe(false);
    }
  });
  it('is case- and null-tolerant, because the value comes off a form and an old row', () => {
    expect(countryPack('in')).toBe(COUNTRY_PACKS.IN);
    expect(countryPack(null).code).toBe('IN');
    expect(countryPack('').code).toBe('IN');
  });
});
