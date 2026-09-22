import type { PayPack } from './pack';

const L = (rupees: number) => rupees * 100; // rupees → paise

/**
 * INDIA — rules as at 22 September 2026.
 *
 * Three things changed in the last year that most published guides still get
 * wrong, and each one is a dated row below rather than a constant:
 *
 *  1. All four Labour Codes commenced on 21 November 2025. The Provident
 *     Fund, ESI, Gratuity and Bonus Acts are now chapters of the Codes, and
 *     full-and-final settlement is due within TWO WORKING DAYS of leaving.
 *  2. The Income-tax Act 2025 applies from 1 April 2026 and renumbered every
 *     salary form: Form 16 → Form 130, Form 12BB → Form 124, Form 24Q → 138.
 *  3. The provident-fund wage ceiling rose from ₹15,000 to ₹25,000 on
 *     17 September 2026 — five days before this file was written. Both rows
 *     are kept, because an arrears run still touches months under the old one.
 */
export const INDIA_PACK: PayPack = {
  country: 'IN',
  label: 'India',
  currency: 'INR',
  taxYearStartMonth: 4,
  version: 'IN-2026.09.22',
  rulesAsAt: '2026-09-22',
  regionLabel: 'State',
  regions: [
    { code: 'AN', name: 'Andaman & Nicobar' }, { code: 'AP', name: 'Andhra Pradesh' },
    { code: 'AR', name: 'Arunachal Pradesh' }, { code: 'AS', name: 'Assam' },
    { code: 'BR', name: 'Bihar' }, { code: 'CH', name: 'Chandigarh' },
    { code: 'CT', name: 'Chhattisgarh' }, { code: 'DL', name: 'Delhi' },
    { code: 'GA', name: 'Goa' }, { code: 'GJ', name: 'Gujarat' },
    { code: 'HR', name: 'Haryana' }, { code: 'HP', name: 'Himachal Pradesh' },
    { code: 'JK', name: 'Jammu & Kashmir' }, { code: 'JH', name: 'Jharkhand' },
    { code: 'KA', name: 'Karnataka' }, { code: 'KL', name: 'Kerala' },
    { code: 'MP', name: 'Madhya Pradesh' }, { code: 'MH', name: 'Maharashtra' },
    { code: 'MN', name: 'Manipur' }, { code: 'ML', name: 'Meghalaya' },
    { code: 'MZ', name: 'Mizoram' }, { code: 'NL', name: 'Nagaland' },
    { code: 'OD', name: 'Odisha' }, { code: 'PY', name: 'Puducherry' },
    { code: 'PB', name: 'Punjab' }, { code: 'RJ', name: 'Rajasthan' },
    { code: 'SK', name: 'Sikkim' }, { code: 'TN', name: 'Tamil Nadu' },
    { code: 'TG', name: 'Telangana' }, { code: 'TR', name: 'Tripura' },
    { code: 'UP', name: 'Uttar Pradesh' }, { code: 'UK', name: 'Uttarakhand' },
    { code: 'WB', name: 'West Bengal' },
  ],

  // ── Income tax ──────────────────────────────────────────────────────────
  // Budget 2026 made no change to either set of slabs. The new regime is the
  // default; a person must opt out to use the old one, which is the only
  // regime where house rent, 80C and 80D are worth anything.
  defaultRegime: 'NEW',
  regimes: [
    {
      from: '2026-04-01',
      key: 'NEW',
      label: 'New regime (default)',
      slabs: [
        { upToMinor: L(400_000), bps: 0 },
        { upToMinor: L(800_000), bps: 500 },
        { upToMinor: L(1_200_000), bps: 1000 },
        { upToMinor: L(1_600_000), bps: 1500 },
        { upToMinor: L(2_000_000), bps: 2000 },
        { upToMinor: L(2_400_000), bps: 2500 },
        { upToMinor: null, bps: 3000 },
      ],
      standardDeductionMinor: L(75_000),
      rebateUptoMinor: L(1_200_000),
      rebateMaxMinor: L(60_000),
      cessBps: 400,
      allows: { hra: false, s80c: false, s80d: false, homeLoanInterest: false },
      s80cCapMinor: 0,
      s80dCapMinor: 0,
    },
    {
      from: '2026-04-01',
      key: 'OLD',
      label: 'Old regime',
      slabs: [
        { upToMinor: L(250_000), bps: 0 },
        { upToMinor: L(500_000), bps: 500 },
        { upToMinor: L(1_000_000), bps: 2000 },
        { upToMinor: null, bps: 3000 },
      ],
      standardDeductionMinor: L(50_000),
      rebateUptoMinor: L(500_000),
      rebateMaxMinor: L(12_500),
      cessBps: 400,
      allows: { hra: true, s80c: true, s80d: true, homeLoanInterest: true },
      s80cCapMinor: L(150_000),
      s80dCapMinor: L(25_000),
    },
  ],

  // ── Provident fund ──────────────────────────────────────────────────────
  retirement: [
    {
      from: '2014-09-01',
      label: 'Provident fund',
      ceilingMinor: L(15_000),
      employeeBps: 1200,
      employerBps: 1200,
      pensionBps: 833,
      pensionCapMinor: L(1_250),
      employerExtraBps: 100, // EDLI + administration, see `unverified`
      minHeadcount: 20,
    },
    {
      // Gazette, 17 September 2026. Around 51 lakh people newly covered:
      // anyone earning ₹15,001–25,000 who was an "excluded employee" must be
      // enrolled, which for a school is most junior teachers and nearly all
      // non-teaching staff.
      from: '2026-09-17',
      label: 'Provident fund',
      ceilingMinor: L(25_000),
      employeeBps: 1200,
      employerBps: 1200,
      pensionBps: 833,
      pensionCapMinor: L(2_083),
      employerExtraBps: 100,
      minHeadcount: 20,
    },
  ],

  // ── ESI ─────────────────────────────────────────────────────────────────
  // Educational institutions were notified across 30 states by January 2024,
  // and ESIC clarified Maharashtra's schools in July 2026. The threshold is
  // 10 staff in most states but 20 in Maharashtra and Chandigarh.
  health: [
    {
      from: '2019-07-01',
      label: 'ESI',
      wageCeilingMinor: L(21_000),
      employeeBps: 75,
      employerBps: 325,
      minHeadcount: 10,
      minHeadcountByRegion: { MH: 20, CH: 20 },
    },
  ],

  // ── Professional tax ────────────────────────────────────────────────────
  // A state levy, capped at ₹2,500 a year by the Constitution. Many states
  // levy nothing at all — Rajasthan among them, which is why a Jaipur school
  // never sees this line.
  localTax: [
    {
      from: '2025-04-01',
      label: 'Professional tax',
      byRegion: {
        MH: {
          frequency: 'MONTHLY',
          slabs: [
            { upToMinor: L(7_500), amountMinor: 0 },
            { upToMinor: L(10_000), amountMinor: L(175) },
            { upToMinor: null, amountMinor: L(200) },
          ],
          specialMonth: { month: 2, amountMinor: L(300) },
          note: 'Women earning up to ₹25,000 a month are exempt — set the person exempt by hand.',
        },
        KA: {
          frequency: 'MONTHLY',
          slabs: [
            { upToMinor: L(25_000), amountMinor: 0 },
            { upToMinor: null, amountMinor: L(200) },
          ],
          note: 'Two bands since 1 April 2025.',
        },
        WB: {
          frequency: 'MONTHLY',
          slabs: [
            { upToMinor: L(10_000), amountMinor: 0 },
            { upToMinor: L(15_000), amountMinor: L(110) },
            { upToMinor: L(25_000), amountMinor: L(130) },
            { upToMinor: L(40_000), amountMinor: L(150) },
            { upToMinor: null, amountMinor: L(200) },
          ],
        },
        TN: {
          frequency: 'HALF_YEARLY',
          months: [8, 1],
          slabs: [
            { upToMinor: L(21_000), amountMinor: 0 },
            { upToMinor: L(30_000), amountMinor: L(135) },
            { upToMinor: L(45_000), amountMinor: L(315) },
            { upToMinor: L(60_000), amountMinor: L(690) },
            { upToMinor: L(75_000), amountMinor: L(1_025) },
            { upToMinor: null, amountMinor: L(1_250) },
          ],
          note: 'Set by each local body and charged on HALF-YEAR income; Chennai’s table is used here. Confirm against your corporation before relying on it.',
        },
        GJ: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(12_000), amountMinor: 0 }, { upToMinor: null, amountMinor: L(200) }] },
        AP: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(15_000), amountMinor: 0 }, { upToMinor: L(20_000), amountMinor: L(150) }, { upToMinor: null, amountMinor: L(200) }] },
        TG: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(15_000), amountMinor: 0 }, { upToMinor: L(20_000), amountMinor: L(150) }, { upToMinor: null, amountMinor: L(200) }] },
        MP: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(18_750), amountMinor: 0 }, { upToMinor: L(25_000), amountMinor: L(125) }, { upToMinor: null, amountMinor: L(208) }] },
        KL: { frequency: 'HALF_YEARLY', months: [8, 2], slabs: [{ upToMinor: L(11_999), amountMinor: 0 }, { upToMinor: L(17_999), amountMinor: L(120) }, { upToMinor: L(29_999), amountMinor: L(180) }, { upToMinor: null, amountMinor: L(300) }] },
        BR: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(25_000), amountMinor: 0 }, { upToMinor: null, amountMinor: L(208) }] },
        JH: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(25_000), amountMinor: 0 }, { upToMinor: null, amountMinor: L(208) }] },
        AS: { frequency: 'MONTHLY', slabs: [{ upToMinor: L(10_000), amountMinor: 0 }, { upToMinor: L(15_000), amountMinor: L(150) }, { upToMinor: null, amountMinor: L(208) }] },
        OD: { frequency: 'NONE', slabs: [], note: 'Repealed from 1 April 2026.' },
      },
    },
  ],

  // ── The 50% rule ────────────────────────────────────────────────────────
  wageShare: [
    {
      from: '2025-11-21',
      maxExcludedShareBps: 5000,
      note: 'Code on Wages: house rent, conveyance, overtime, bonus and employer contributions together may not exceed half of total pay. In practice Basic plus dearness allowance must be at least half of gross, and the excess is deemed wages if it is not.',
    },
  ],

  gratuity: [
    {
      from: '2026-03-01',
      label: 'Gratuity',
      numerator: 15,
      denominator: 26,
      minYears: 5,
      minYearsFixedTerm: 1,
      exemptMinor: L(2_000_000),
    },
  ],

  filings: [
    { key: 'TDS', label: 'Deposit tax deducted', cadence: 'MONTHLY', dueDay: 7, note: '30 April for March.' },
    { key: 'PF_ECR', label: 'Provident fund return and challan', cadence: 'MONTHLY', dueDay: 15 },
    { key: 'ESI', label: 'ESI contribution', cadence: 'MONTHLY', dueDay: 15 },
    { key: 'PT', label: 'Professional tax', cadence: 'MONTHLY', dueDay: 20, note: 'Frequency and due day vary by state.' },
    { key: 'FORM_138', label: 'Form 138 — quarterly salary TDS return', cadence: 'QUARTERLY', dueMonths: [7, 10, 1, 5], dueDay: 31, note: 'Was Form 24Q. ₹200 a day late.' },
    { key: 'FORM_130', label: 'Form 130 — the annual certificate', cadence: 'ANNUAL', dueMonths: [6], dueDay: 15, note: 'Was Form 16. Generated from the tax portal after the fourth-quarter return is processed.' },
    { key: 'BONUS', label: 'Pay statutory bonus', cadence: 'ANNUAL', dueMonths: [11], dueDay: 30, note: 'Within eight months of the year end.' },
  ],

  payDueDay: 7,
  fnfWorkingDays: 2,

  unverified: [
    { what: 'Provident fund administration and insurance charge (set at 1% here)', why: 'Sources give 0.5% and 0.85%; confirm against the current EPFO circular before a school relies on the employer-cost figure.' },
    { what: 'Tamil Nadu and Kerala professional tax slabs', why: 'Set by each local body and revised often. Chennai’s table is used for Tamil Nadu.' },
    { what: 'The ₹21,000 bonus eligibility ceiling', why: 'The Code on Wages lets states set their own; treat the old figure as pending a state notification.' },
  ],

  // ── The structure a new Indian school starts with ───────────────────────
  // Basic at 50% of gross satisfies the Code on Wages rule by construction,
  // house rent at 40% of Basic is the non-metro convention, and the special
  // allowance is the plug that makes the parts add up to what was offered.
  standardComponents: [
    { key: 'basic', name: 'Basic', kind: 'EARNING', calc: 'PCT_OF_GROSS', rateBps: 5000, taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 1, hint: 'The base for provident fund, gratuity and bonus. Keep it at half of gross or more.' },
    { key: 'da', name: 'Dearness allowance', kind: 'EARNING', calc: 'FIXED', taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 2, hint: 'Government and aided schools carry it; most private schools leave it at zero.' },
    { key: 'hra', name: 'House rent allowance', kind: 'EARNING', calc: 'PCT_OF_BASIC', rateBps: 4000, taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 3, hint: 'Exempt against rent paid, on the old regime only.' },
    { key: 'conveyance', name: 'Conveyance', kind: 'EARNING', calc: 'FIXED', taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 4, hint: 'A convention now, not an exemption.' },
    { key: 'special', name: 'Special allowance', kind: 'EARNING', calc: 'BALANCE', taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 9, hint: 'Whatever is left after the others, so the parts add to the agreed gross.' },
  ],
};
