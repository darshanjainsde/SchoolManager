import { ResendApiError } from './resend-transport';

/** What one letter came to — the email half of DeliveryOutcome. */
export type MailOutcome =
  | { status: 'SENT'; providerId: string | null }
  | { status: 'SUPPRESSED'; reason: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/**
 * Handed down to `sendLetter` by a caller that needs more than a boolean (the
 * outbox drain). The boolean return stays for every other caller.
 */
export interface MailOutcomeSink {
  outcome?: MailOutcome;
}

/**
 * SMTP replies carry a numeric `responseCode` on nodemailer's error: 4xx is
 * "try later", 5xx is "never". Resend speaks HTTP: a 4xx other than 429 is a
 * request it will refuse again; 429 and 5xx pass. No code at all means the
 * server was never reached — try again.
 */
export function mailFailure(e: unknown): MailOutcome {
  const error = ((e as Error)?.message ?? 'unknown error').slice(0, 500);
  const smtp = (e as { responseCode?: unknown } | null)?.responseCode;
  if (typeof smtp === 'number') return smtp >= 500 ? { status: 'FAILED', error } : { status: 'RETRY', error };
  if (e instanceof ResendApiError) {
    const permanent = e.httpStatus >= 400 && e.httpStatus < 500 && e.httpStatus !== 429;
    return permanent ? { status: 'FAILED', error } : { status: 'RETRY', error };
  }
  return { status: 'RETRY', error };
}
