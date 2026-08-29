/**
 * What a school charges when a bill is paid late.
 *
 * A pure function, deliberately: the amount a parent is shown, the amount the
 * office sees on the verify desk, and the amount posted to the ledger all come
 * through here, so those three can never disagree. Every input is explicit —
 * nothing reads the clock or the database.
 *
 * The rule from the design pitch that shapes this: a late fee is computed
 * **as of the moment it is being looked at**, not by a nightly job. A cron
 * that adds a fee row is wrong twice — it charges a parent who paid at 9am for
 * a job that ran at 2am, and it makes the amount depend on whether the job ran
 * at all. Here the answer is a function of (due date, today, what is owed), so
 * it is the same answer whoever asks and whenever.
 */

/** How the school charges. NONE is a first-class choice, not an absence. */
export type LateFeeMode = 'NONE' | 'FLAT' | 'PER_DAY';

export interface LateFeeRule {
  mode: LateFeeMode;
  /** FLAT: charged once. PER_DAY: charged per day late. Paise. */
  amountMinor: number;
  /** Days after the due date before anything is charged. */
  graceDays: number;
  /** Ceiling in paise. Null means uncapped. Mostly matters for PER_DAY. */
  capMinor: number | null;
}

export interface LateFeeInput {
  rule: LateFeeRule;
  /** The bill's due date. A calendar date — time of day is not meaningful. */
  dueDate: Date;
  /** The instant being asked about. Usually now; the payment date when settling. */
  asOf: Date;
  /** What is still owed on the bill, in paise. No debt, no late fee. */
  outstandingMinor: number;
  /**
   * False for a government-reimbursed (RTE) bill. Such a student is never a
   * defaulter, so charging them for lateness would be incoherent.
   */
  isCollectible: boolean;
}

/**
 * Whole days late, counted in the school's timezone.
 *
 * IST rather than the server's zone because "due 10 September" is a calendar
 * fact in Jaipur, and a server in UTC would otherwise call 10 Sep 11pm IST the
 * 10th and 11 Sep 4am IST the 10th as well — the boundary has to be the one the
 * parent and the office both mean.
 */
export function daysLate(dueDate: Date, asOf: Date, timeZone = 'Asia/Kolkata'): number {
  const day = (d: Date) => {
    // en-CA renders as YYYY-MM-DD, which parses back as a pure date.
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    return Date.parse(`${iso}T00:00:00Z`);
  };
  const diff = day(asOf) - day(dueDate);
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

/** The late fee in paise. Zero whenever the rule, the debt or the date says so. */
export function computeLateFee(input: LateFeeInput): number {
  const { rule, dueDate, asOf, outstandingMinor, isCollectible } = input;

  if (rule.mode === 'NONE') return 0;
  if (!isCollectible) return 0;
  if (outstandingMinor <= 0) return 0;
  if (rule.amountMinor <= 0) return 0;

  const late = daysLate(dueDate, asOf);
  const chargeableDays = late - Math.max(0, rule.graceDays);
  if (chargeableDays <= 0) return 0;

  const raw = rule.mode === 'FLAT' ? rule.amountMinor : rule.amountMinor * chargeableDays;
  const capped = rule.capMinor != null && rule.capMinor > 0 ? Math.min(raw, rule.capMinor) : raw;

  // A late fee that exceeds the debt it is charged on reads as a penalty rather
  // than a charge, and is the fastest way to make a parent distrust the bill.
  return Math.min(capped, outstandingMinor);
}

/** One line of plain English, shown to the parent beside the amount. */
export function describeLateFeeRule(rule: LateFeeRule): string | null {
  if (rule.mode === 'NONE' || rule.amountMinor <= 0) return null;
  const rupees = (m: number) => `₹${(m / 100).toLocaleString('en-IN')}`;
  const grace = rule.graceDays > 0 ? ` after ${rule.graceDays} grace ${rule.graceDays === 1 ? 'day' : 'days'}` : '';
  const cap = rule.capMinor && rule.capMinor > 0 ? `, up to ${rupees(rule.capMinor)}` : '';
  return rule.mode === 'FLAT'
    ? `${rupees(rule.amountMinor)} once the due date passes${grace}`
    : `${rupees(rule.amountMinor)} per day past the due date${grace}${cap}`;
}

/** Adapts a stored `FeeSettings` row to the pure rule shape. */
export function ruleFromSettings(s: {
  lateFeeMode: string;
  lateFeeAmountMinor: number;
  lateFeeGraceDays: number;
  lateFeeCapMinor: number;
}): LateFeeRule {
  return {
    mode: s.lateFeeMode as LateFeeMode,
    amountMinor: s.lateFeeAmountMinor,
    graceDays: s.lateFeeGraceDays,
    // 0 is stored for "uncapped" because the column is NOT NULL; the pure
    // function speaks in null, so the translation happens here and once.
    capMinor: s.lateFeeCapMinor > 0 ? s.lateFeeCapMinor : null,
  };
}
