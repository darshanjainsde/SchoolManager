import {
  PAYSLIP_CSS, daysPaidLabel, isPayslipDoc, payslipBody, payslipFileName, payslipHtml, payslipRupees,
  type PayslipDoc,
} from './payslip-doc';

const doc = (o: Partial<PayslipDoc> = {}): PayslipDoc => ({
  id: 'slip-1',
  periodLabel: 'September 2026', periodYear: 2026, periodMonth: 9,
  person: {
    name: 'Rajeshwari Balasubramanian', designation: 'Trained Graduate Teacher', kind: 'TEACHER',
    pan: 'ABCDE1234F', uan: '100123456789', bankAccountLast4: '4821', joinedOn: '2019-06-01T00:00:00.000Z',
  },
  lines: [
    { key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 2_402_400 },
    { key: 'hra', name: 'House rent allowance', kind: 'EARNING', amountMinor: 960_960 },
    { key: 'pf', name: 'Provident fund', kind: 'DEDUCTION', amountMinor: 180_000 },
    { key: 'pf_er', name: 'Provident fund — school', kind: 'EMPLOYER_COST', amountMinor: 180_000 },
  ],
  daysInMonth: 30, daysPaid: 30, lopHalfDays: 0,
  grossMinor: 3_363_360, deductionMinor: 180_000, netMinor: 3_183_360, employerCostMinor: 180_000,
  incomeTaxMinor: 0, taxRegime: 'NEW', ytdGrossMinor: 20_180_160, ytdTaxMinor: 0,
  paidOn: '2026-10-01T00:00:00.000Z', school: { name: 'Raffles Primary School' },
  rulesAsAt: '2026-09-22T00:00:00.000Z', packVersion: 'IN-2026.09.22',
  ...o,
});

describe('the payslip as paper', () => {
  it('names the school, the person and the month', () => {
    const html = payslipBody(doc());
    expect(html).toContain('Raffles Primary School');
    expect(html).toContain('Rajeshwari Balasubramanian');
    expect(html).toContain('September 2026');
  });

  it('separates what was earned, taken off, and paid in on top', () => {
    // The employer's share is the line most payslips leave out, and the one
    // that makes a person read their pay as smaller than the job.
    const html = payslipBody(doc());
    expect(html).toContain('Basic');
    expect(html).toContain('Provident fund');
    expect(html).toContain('The school also paid in, on top');
  });

  it('never prints the whole bank account', () => {
    // A payslip gets photographed and emailed around. The last four are
    // enough to recognise the account; the rest is not ours to scatter.
    const html = payslipBody(doc());
    expect(html).toContain('A/c ending 4821');
    expect(html).not.toContain('4821000');
  });

  it('leaves out a number the school does not hold', () => {
    const html = payslipBody(doc({ person: { ...doc().person, pan: null, uan: null, bankAccountLast4: null } }));
    expect(html).not.toContain('PAN');
    expect(html).not.toContain('UAN');
    expect(html).not.toContain('A/c ending');
  });

  it('says a short month in days, and only when it is short', () => {
    expect(payslipBody(doc())).not.toContain('Paid for');
    const short = payslipBody(doc({ daysPaid: 27, lopHalfDays: 1 }));
    expect(short).toContain('27½ of 30 days');
  });

  it('does not claim money has been paid before it has', () => {
    expect(payslipBody(doc({ paidOn: null }))).toContain('not yet paid');
    expect(payslipBody(doc())).toContain('Paid 1 Oct 2026');
  });

  it('escapes a name that contains markup', () => {
    const html = payslipBody(doc({ school: { name: '<script>alert(1)</script>' } }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders rather than throwing when the lines are missing', () => {
    // It opens on a teacher's own phone. A worse payslip beats a white screen.
    const broken = { ...doc(), lines: undefined } as unknown as PayslipDoc;
    expect(() => payslipBody(broken)).not.toThrow();
    expect(payslipBody(broken)).toContain('Nothing');
  });

  it('writes rupees the Indian way', () => {
    expect(payslipRupees(3_183_360)).toBe('₹31,833.60');
    // 2,347,400,000 paise = ₹2,34,74,000 — crore-scale, grouped the Indian way.
    expect(payslipRupees(2_34_74_000_00)).toBe('₹2,34,74,000');
    expect(payslipRupees(-50_000)).toBe('−₹500');
  });

  it('labels a whole month without a fraction', () => {
    expect(daysPaidLabel(30, 0, 30)).toBe('30 of 30 days');
    expect(daysPaidLabel(28, 1, 31)).toBe('28½ of 31 days');
  });

  it('gives the file a name a person can find again', () => {
    expect(payslipFileName(doc())).toBe('Payslip Rajeshwari Balasubramanian September 2026.pdf');
    expect(payslipFileName(doc(), 'html')).toMatch(/\.html$/);
  });

  it('makes a whole document the phone can print', () => {
    const html = payslipHtml(doc());
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('@page{size:A4');
    expect(html).toContain(PAYSLIP_CSS.trim().slice(0, 40));
  });

  it('refuses a shape that is not a payslip', () => {
    expect(isPayslipDoc(doc())).toBe(true);
    expect(isPayslipDoc(null)).toBe(false);
    expect(isPayslipDoc({})).toBe(false);
    // The raw Prisma payslip an older API returns: no periodLabel, no person.
    expect(isPayslipDoc({ id: 'x', lines: [], netMinor: 1 })).toBe(false);
  });
});
