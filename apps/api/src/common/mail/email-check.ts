/**
 * "Will this address take mail?" — answered BEFORE the office saves it, so a
 * typo is caught at the keyboard instead of by a bounce three days later.
 *
 * What can be known without sending: the syntax; the domain's mail servers
 * (an MX record — no MX and no A means nothing will ever accept mail there);
 * the ten most common typos of the domains Indian families actually use; a
 * short list of throw-away providers; and whether WE have already seen the
 * address bounce. What cannot be known without sending: whether the mailbox
 * behind a good domain exists — SMTP verification is blocked or lied to by
 * every large provider. So the verdict is advisory ("looks fine" / "check
 * this") and the caller warns rather than blocks — the house rule.
 *
 * Pure apart from the resolver, which is injected so the spec runs offline.
 */
export type EmailVerdict =
  | { ok: true; normalized: string; note?: string }
  | { ok: false; normalized: string; reason: EmailProblem; suggestion?: string; detail?: string };

export type EmailProblem = 'SYNTAX' | 'TYPO' | 'NO_MAIL_SERVER' | 'DISPOSABLE' | 'BOUNCED_BEFORE';

export interface DnsResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
}

/** The domains a school office types most, and how they get them wrong. */
const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.comm': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com', 'rediffmail.co': 'rediffmail.com', 'redifmail.com': 'rediffmail.com',
  'icloud.co': 'icloud.com', 'protonmail.co': 'protonmail.com',
};

const DISPOSABLE = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com',
  'getnada.com', 'dispostable.com', 'fakeinbox.com', 'sharklasers.com', 'throwawaymail.com', 'maildrop.cc',
]);

/** RFC-ish, deliberately simpler than the standard: one @, a dotted domain, no spaces. */
const SYNTAX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Trim and lower-case only. An interior space is left in place so it fails
 *  the syntax check — gluing "ra vi@" into "ravi@" would quietly produce a
 *  different mailbox, which is worse than a warning. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Everything that needs no network — the part a form can run on every keystroke. */
export function checkEmailSyntax(raw: string): EmailVerdict {
  const normalized = normalizeEmail(raw);
  if (!SYNTAX.test(normalized) || normalized.includes('..')) return { ok: false, normalized, reason: 'SYNTAX' };
  const domain = normalized.split('@')[1];
  const fixed = TYPOS[domain];
  if (fixed) return { ok: false, normalized, reason: 'TYPO', suggestion: `${normalized.split('@')[0]}@${fixed}` };
  if (DISPOSABLE.has(domain)) return { ok: false, normalized, reason: 'DISPOSABLE' };
  return { ok: true, normalized };
}

/** The full verdict: syntax, then the domain's mail servers, then our own bounce memory. */
export async function checkEmail(
  raw: string,
  deps: { dns: DnsResolver; isSuppressed: (email: string) => Promise<{ reason: string; detail: string | null } | null> },
): Promise<EmailVerdict> {
  const first = checkEmailSyntax(raw);
  if (!first.ok) return first;
  const { normalized } = first;
  const domain = normalized.split('@')[1];
  let hasServer = false;
  try {
    const mx = await deps.dns.resolveMx(domain);
    hasServer = mx.some((m) => m.exchange && m.exchange !== '.');
  } catch {
    /* no MX — fall through to A */
  }
  if (!hasServer) {
    try {
      hasServer = (await deps.dns.resolve4(domain)).length > 0;
    } catch {
      hasServer = false;
    }
  }
  if (!hasServer) return { ok: false, normalized, reason: 'NO_MAIL_SERVER', detail: `${domain} has no mail server` };
  const sup = await deps.isSuppressed(normalized);
  if (sup) return { ok: false, normalized, reason: 'BOUNCED_BEFORE', detail: sup.detail ?? sup.reason };
  return { ok: true, normalized };
}

/** The words a form shows for each verdict. */
export function emailVerdictWords(v: EmailVerdict): string {
  if (v.ok) return 'Looks fine.';
  switch (v.reason) {
    case 'SYNTAX': return 'That is not a complete email address.';
    case 'TYPO': return `Did you mean ${v.suggestion}?`;
    case 'NO_MAIL_SERVER': return `Nothing receives mail at ${v.normalized.split('@')[1]} — check the spelling.`;
    case 'DISPOSABLE': return 'That is a throw-away address; notices sent there will not be read.';
    case 'BOUNCED_BEFORE': return `Mail to this address bounced before${v.detail ? ` (${v.detail})` : ''}. Confirm it with the family.`;
  }
}
