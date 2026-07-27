/**
 * Currency support for the public pricing page.
 *
 * Two currencies are *billed* currencies: USD and INR. Their amounts come from
 * the owner console (MarketingConfig) and are never touched by exchange rates —
 * a subscription price must not drift day to day.
 *
 * Every other currency is a courtesy conversion from the USD price using live
 * mid-market rates (refreshed a few times a day, cached by Next), rounded to a
 * clean number and always shown with a "≈" so nobody reads it as a quote.
 */

export const BILLED_CURRENCIES = ['USD', 'INR'] as const;

export interface Currency {
  code: string;
  /** Shown in the picker, e.g. "Indian Rupee". */
  name: string;
  /** Locale used for grouping/symbol when formatting. */
  locale: string;
}

/** Billed currencies first, then converted ones roughly by market relevance. */
export const CURRENCIES: Currency[] = [
  { code: 'INR', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', name: 'US Dollar', locale: 'en-US' },
  { code: 'AED', name: 'UAE Dirham', locale: 'en-US' },
  { code: 'SAR', name: 'Saudi Riyal', locale: 'en-US' },
  { code: 'QAR', name: 'Qatari Riyal', locale: 'en-US' },
  { code: 'OMR', name: 'Omani Rial', locale: 'en-US' },
  { code: 'KWD', name: 'Kuwaiti Dinar', locale: 'en-US' },
  { code: 'BHD', name: 'Bahraini Dinar', locale: 'en-US' },
  { code: 'GBP', name: 'British Pound', locale: 'en-GB' },
  { code: 'EUR', name: 'Euro', locale: 'en-IE' },
  { code: 'SGD', name: 'Singapore Dollar', locale: 'en-US' },
  { code: 'MYR', name: 'Malaysian Ringgit', locale: 'en-US' },
  { code: 'AUD', name: 'Australian Dollar', locale: 'en-US' },
  { code: 'NZD', name: 'New Zealand Dollar', locale: 'en-US' },
  { code: 'CAD', name: 'Canadian Dollar', locale: 'en-US' },
  { code: 'NPR', name: 'Nepalese Rupee', locale: 'en-US' },
  { code: 'LKR', name: 'Sri Lankan Rupee', locale: 'en-US' },
  { code: 'BDT', name: 'Bangladeshi Taka', locale: 'en-US' },
  { code: 'PKR', name: 'Pakistani Rupee', locale: 'en-US' },
  { code: 'PHP', name: 'Philippine Peso', locale: 'en-US' },
  { code: 'IDR', name: 'Indonesian Rupiah', locale: 'en-US' },
  { code: 'THB', name: 'Thai Baht', locale: 'en-US' },
  { code: 'ZAR', name: 'South African Rand', locale: 'en-US' },
  { code: 'KES', name: 'Kenyan Shilling', locale: 'en-US' },
  { code: 'NGN', name: 'Nigerian Naira', locale: 'en-US' },
  { code: 'TZS', name: 'Tanzanian Shilling', locale: 'en-US' },
  { code: 'EGP', name: 'Egyptian Pound', locale: 'en-US' },
  { code: 'JPY', name: 'Japanese Yen', locale: 'en-US' },
  { code: 'HKD', name: 'Hong Kong Dollar', locale: 'en-US' },
];

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string | null | undefined): boolean {
  return !!code && CURRENCY_BY_CODE.has(code);
}

/** Visitor country (ISO-3166 alpha-2) → the currency we default their view to. */
const COUNTRY_CURRENCY: Record<string, string> = {
  IN: 'INR', AE: 'AED', SA: 'SAR', QA: 'QAR', OM: 'OMR', KW: 'KWD', BH: 'BHD',
  GB: 'GBP', SG: 'SGD', MY: 'MYR', AU: 'AUD', NZ: 'NZD', CA: 'CAD',
  NP: 'NPR', LK: 'LKR', BD: 'BDT', PK: 'PKR', PH: 'PHP', ID: 'IDR', TH: 'THB',
  ZA: 'ZAR', KE: 'KES', NG: 'NGN', TZ: 'TZS', EG: 'EGP', JP: 'JPY', HK: 'HKD',
  // Eurozone
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR',
  LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
};

/** Best-guess starting currency for a visitor. Falls back to USD. */
export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return 'USD';
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';
}

export type Rates = Record<string, number>;

/**
 * Approximate USD mid-market rates, used only when the FX endpoint is
 * unreachable. Being a few percent stale is fine — every converted price is
 * labelled approximate and nothing is billed in these currencies.
 */
const FALLBACK_RATES: Rates = {
  USD: 1, INR: 86, AED: 3.67, SAR: 3.75, QAR: 3.64, OMR: 0.385, KWD: 0.307,
  BHD: 0.376, GBP: 0.78, EUR: 0.92, SGD: 1.34, MYR: 4.4, AUD: 1.52, NZD: 1.66,
  CAD: 1.37, NPR: 137, LKR: 300, BDT: 120, PKR: 280, PHP: 57, IDR: 16300,
  THB: 33, ZAR: 18.2, KES: 129, NGN: 1550, TZS: 2600, EGP: 49, JPY: 150, HKD: 7.8,
};

/**
 * Live USD-based rates from open.er-api.com (free, no API key), cached for 6 h
 * by the Next data cache. Any failure falls back to the table above — the
 * pricing page must never fail to render because an FX API is down.
 */
export async function fetchUsdRates(): Promise<Rates> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 21600 },
    });
    if (!res.ok) return FALLBACK_RATES;
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (json.result !== 'success' || !json.rates) return FALLBACK_RATES;

    const rates: Rates = { USD: 1 };
    for (const { code } of CURRENCIES) {
      const r = json.rates[code];
      if (typeof r === 'number' && r > 0) rates[code] = r;
      else if (FALLBACK_RATES[code]) rates[code] = FALLBACK_RATES[code];
    }
    return rates;
  } catch {
    return FALLBACK_RATES;
  }
}

/** Rounds a converted amount to a clean, price-looking number. */
export function roundPretty(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step =
    value < 50 ? 1
    : value < 200 ? 5
    : value < 1_000 ? 10
    : value < 10_000 ? 50
    : value < 100_000 ? 500
    : value < 1_000_000 ? 5_000
    : 50_000;
  return Math.max(step, Math.round(value / step) * step);
}

/** Converts a USD amount into `code`, rounded for display. */
export function convertFromUsd(usd: number, code: string, rates: Rates): number {
  const rate = rates[code] ?? FALLBACK_RATES[code];
  if (!rate) return usd;
  return roundPretty(usd * rate);
}

/** e.g. `formatMoney(4999, 'INR')` → "₹4,999". */
export function formatMoney(amount: number, code: string): string {
  const cur = CURRENCY_BY_CODE.get(code);
  const locale = cur?.locale ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString(locale)}`;
  }
}
