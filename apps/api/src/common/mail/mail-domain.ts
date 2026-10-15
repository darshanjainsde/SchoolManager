import { promises as nodeDns } from 'node:dns';
import type { DnsResolver } from './email-check';

/**
 * "Can ANY mail reach this domain?" — asked at SEND time, so a letter to an
 * address that can only bounce is never handed to the sender at all.
 *
 * Why at send time when the forms already check as the office types
 * (email-check.ts): the form only warns, imports and sample packs skip the
 * form, and a bounce from a school's OWN mailbox (Gmail SMTP) lands in that
 * mailbox's inbox, where we never see it to suppress the address. A burst of
 * "Undelivered Mail Returned to Sender" is the result.
 *
 * Only a definite answer stops a letter: a reserved name (RFC 2606 / 6761 —
 * `.test`, `example.com`… can never take mail), a null MX (RFC 7505), or DNS
 * saying the name does not exist / has no mail or address records. A DNS
 * timeout or server failure says nothing about the domain, so the letter goes.
 * A mailbox that does not exist on a real domain cannot be known without
 * sending; that stays the bounce list's job.
 */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost', 'local'];
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

/** DNS codes that are an ANSWER ("no such name", "no such record"), not an outage. */
const DEFINITE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

const DEAD_TTL_MS = 60 * 60_000;
const ALIVE_TTL_MS = 6 * 60 * 60_000;
const MAX_ENTRIES = 5_000;

export function reservedMailDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.$/, '');
  if (RESERVED_DOMAINS.has(d) || [...RESERVED_DOMAINS].some((r) => d.endsWith(`.${r}`))) return true;
  const tld = d.split('.').pop() ?? '';
  return RESERVED_TLDS.includes(tld);
}

type Answer = 'yes' | 'no' | 'unknown';

async function lookup(fn: () => Promise<unknown[]>): Promise<{ answer: Answer; rows: unknown[] }> {
  try {
    const rows = await fn();
    return { answer: rows.length ? 'yes' : 'no', rows };
  } catch (e) {
    return { answer: DEFINITE.has((e as { code?: string })?.code ?? '') ? 'no' : 'unknown', rows: [] };
  }
}

export class MailDomainCheck {
  private readonly cache = new Map<string, { dead: string | null; expires: number }>();

  constructor(
    private readonly dns: DnsResolver = { resolveMx: (d) => nodeDns.resolveMx(d), resolve4: (d) => nodeDns.resolve4(d) },
    private readonly now: () => number = Date.now,
  ) {}

  /** Why mail to this address can never arrive, or null when it might. */
  async whyUndeliverable(address: string): Promise<string | null> {
    const domain = (address.split('@')[1] ?? '').trim().toLowerCase();
    if (!domain) return 'no domain in the address';
    if (reservedMailDomain(domain)) return `${domain} is a test domain that never receives mail`;

    const hit = this.cache.get(domain);
    if (hit && hit.expires > this.now()) return hit.dead;

    const dead = await this.probe(domain);
    if (dead !== undefined) {
      if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
      this.cache.set(domain, { dead, expires: this.now() + (dead ? DEAD_TTL_MS : ALIVE_TTL_MS) });
    }
    return dead ?? null;
  }

  /** null = takes mail, a string = never will, undefined = could not tell (not cached). */
  private async probe(domain: string): Promise<string | null | undefined> {
    const mx = await lookup(() => this.dns.resolveMx(domain));
    if (mx.answer === 'yes') {
      const real = (mx.rows as { exchange: string }[]).some((m) => m.exchange && m.exchange !== '.');
      return real ? null : `${domain} says it accepts no mail`;
    }
    if (mx.answer === 'unknown') return undefined;
    // No MX: mail falls back to the domain's own address (RFC 5321 §5.1).
    const a = await lookup(() => this.dns.resolve4(domain));
    if (a.answer === 'yes') return null;
    if (a.answer === 'unknown') return undefined;
    return `nothing receives mail at ${domain}`;
  }
}
