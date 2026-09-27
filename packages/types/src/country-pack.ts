import { DEFAULT_COUNTRY } from './countries';

/**
 * THE COUNTRY SWITCH.
 *
 * A school carries `School.countryCode`. Everything that legitimately differs
 * by country — which festivals the Studio offers, the default timezone and
 * locale, later the academic-year start, the phone format, the holiday table
 * — hangs off ONE lookup: `countryPack(code)`.
 *
 * Today India is the only pack that is written out, and every other country
 * INHERITS it (`inheritedFrom: 'IN'`), so a school created in any country
 * behaves exactly as an Indian school does now. That is deliberate: the
 * switch exists from day one, nothing changes until a pack is written, and
 * writing one is adding an entry here — no code path has to learn a new
 * concept. The payroll module already works this way (`packFor(countryCode)`
 * in pay-pack.service.ts); this generalises the idea to the rest of the
 * product.
 *
 * Festival KEYS live here as strings rather than the web app's FestivalKey
 * type, because this package is shared by api, web and mobile and must not
 * import a renderer's catalogue. 'SHARED' means "the whole shared catalogue",
 * which is what every country gets until it declares its own list.
 */
export interface CountryPack {
  /** ISO 3166-1 alpha-2. */
  code: string;
  label: string;
  /** IANA zone a new school in this country starts on. */
  timezone: string;
  /** BCP-47 locale for dates, numbers and copy. */
  locale: string;
  /** ISO 4217. */
  currency: string;
  /**
   * Which festivals the website Studio offers. 'SHARED' = the whole shared
   * catalogue (today: the Indian calendar plus the national days). A country
   * that wants its own set lists the keys it wants, in the order it wants.
   */
  festivals: 'SHARED' | readonly string[];
  /** Set on the pack a country falls back to when it has none of its own. */
  inheritedFrom?: string;
}

const IN: CountryPack = {
  code: 'IN',
  label: 'India',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  currency: 'INR',
  festivals: 'SHARED',
};

/**
 * Packs that have been written out. Adding a country = adding an entry.
 * Everything not here inherits DEFAULT_PACK and says so.
 */
export const COUNTRY_PACKS: Readonly<Record<string, CountryPack>> = { IN };

export const DEFAULT_PACK: CountryPack = COUNTRY_PACKS[DEFAULT_COUNTRY];

/** The pack for a country, or the default pack marked as inherited. */
export function countryPack(code: string | null | undefined): CountryPack {
  // Empty string is what a form field sends when nothing was chosen; it means the default, not a country called ''.
  const c = (code?.trim() || DEFAULT_COUNTRY).toUpperCase();
  const own = COUNTRY_PACKS[c];
  if (own) return own;
  return { ...DEFAULT_PACK, code: c, inheritedFrom: DEFAULT_PACK.code };
}

/** True when this country has its own pack rather than inheriting the default. */
export function hasOwnPack(code: string | null | undefined): boolean {
  return !!code && Object.prototype.hasOwnProperty.call(COUNTRY_PACKS, code.toUpperCase());
}
