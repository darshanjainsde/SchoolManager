/**
 * Phone normalisation for WhatsApp. Meta wants E.164 without the plus
 * ("919876543210"); we STORE with the plus so the ledger reads as a phone.
 *
 * `Student.guardianPhone` and `Teacher.phone` are free text typed by an
 * office: "98765 43210", "+91-98765-43210", "0 9876543210", "9876543210".
 * All four are the same Indian mobile. Anything that does not resolve to a
 * plausible number returns null and the recipient is simply skipped — a
 * wrong number must never become a wrong family's notice.
 */
export function toE164(raw: string | null | undefined, defaultCountry: 'IN' = 'IN'): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  // A leading trunk zero on a domestic number ("09876543210").
  if (defaultCountry === 'IN' && digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (defaultCountry === 'IN' && digits.length === 10) {
    // Indian mobiles start 6–9; a landline or a typo does not get WhatsApp.
    if (!/^[6-9]/.test(digits)) return null;
    digits = `91${digits}`;
  }
  if (digits.length < 11 || digits.length > 15) return null;
  return `+${digits}`;
}

/** What the Graph API wants in `to`: E.164 digits, no plus. */
export const forGraph = (e164: string) => e164.replace(/^\+/, '');
