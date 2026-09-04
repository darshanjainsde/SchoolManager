import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../../common/errors/api-error';
import { SchoolLookupService } from '../../tenancy';
import { HostingProviderService, type HostingStatus } from './hosting-provider.service';

/**
 * Putting a school on its OWN domain (stmarys.edu.in rather than
 * stmarys.sckools.com).
 *
 * The product already resolved any hostname to a tenant — a `Domain` row with
 * status LIVE is all the request path needs. What was missing was the operator
 * flow around it: hand the school records to add, then confirm those records
 * actually point here before flipping the switch. That order matters. A domain
 * marked LIVE whose DNS is not ready yet is worse than one still PENDING: the
 * school's whole site 404s, and nothing in the product explains why.
 *
 * WHAT THIS SERVICE DOES NOT DO: attach the domain to the hosting project.
 * That needs the hosting provider's own API token and is a deliberate manual
 * step — surfaced in `instructions` so it is never silently skipped.
 */
@Injectable()
export class OwnerDomainsService {
  private readonly logger = new Logger(OwnerDomainsService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly lookup: SchoolLookupService,
    private readonly hosting: HostingProviderService,
  ) {}

  private hostnameOk(hostname: string): boolean {
    return /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(hostname) && !hostname.endsWith('.');
  }

  /**
   * The records a school's DNS admin must add, in their own words.
   *
   * The value has to be one a registrar's form will actually accept. An A
   * record takes a literal IPv4 address and nothing else — handing back the
   * CNAME target here produced "Value must be a valid IPv4 address" at
   * Hostinger and made every apex onboarding impossible. So the record kind
   * and the value are chosen together, never independently.
   */
  private instructions(hostname: string) {
    const isApex = hostname.split('.').length === 2;
    const label = hostname.split('.')[0];

    if (isApex) {
      // A root domain cannot hold a CNAME (RFC 1034 §3.6.2 — no other data may
      // coexist with it, and an apex always carries SOA and NS).
      const ip = this.env.INGRESS_A_RECORD;
      return {
        kind: 'A' as const,
        host: '@',
        value: ip,
        note:
          `${hostname} is a root domain, which cannot hold a CNAME — that is why this is an A record ` +
          `pointing at the literal address ${ip}. If your registrar offers ALIAS or ANAME, you may ` +
          `instead point that at ${this.env.INGRESS_CNAME_TARGET}, which survives a change of address.`,
        alsoRequired: this.attachNote(hostname),
      };
    }

    const target = this.env.INGRESS_CNAME_TARGET;
    return {
      kind: 'CNAME' as const,
      host: label,
      value: target,
      note: `Add a CNAME on "${label}" pointing at ${target}.`,
      alsoRequired: this.attachNote(hostname),
    };
  }

  /**
   * Whether the operator still has manual work to do. When we hold hosting
   * credentials this happens automatically on `add`, and saying otherwise
   * sends people to a dashboard for no reason.
   */
  private attachNote(hostname: string): string {
    return this.hosting.configured
      ? `${hostname} is attached to the hosting project automatically — no dashboard step needed.`
      : `Add ${hostname} to the hosting project as well — DNS alone does not issue the certificate.`;
  }

  async list(schoolId: string) {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { id: true, slug: true, name: true },
    });
    if (!school) throw new NotFoundException('School not found');

    const domains = await db.domain.findMany({
      where: { schoolId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return {
      school: { id: school.id, name: school.name, slug: school.slug },
      /** Always reachable, never removable — the safety net under every school. */
      platformHost: `${school.slug}.${this.env.PLATFORM_HOST}`,
      cnameTarget: this.env.INGRESS_CNAME_TARGET,
      domains: domains.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        type: d.type,
        status: d.status,
        isPrimary: d.isPrimary,
        createdAt: d.createdAt.toISOString(),
        instructions: this.instructions(d.hostname),
      })),
    };
  }

  async add(schoolId: string, hostnameRaw: string) {
    const hostname = hostnameRaw.trim().toLowerCase().replace(/\.$/, '');
    if (!this.hostnameOk(hostname)) {
      throw new ApiError('VALIDATION', 'That does not look like a domain name.', 400, 'hostname');
    }
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundException('School not found');

    // hostname is globally unique: one address can only ever mean one school.
    const clash = await db.domain.findUnique({ where: { hostname }, select: { schoolId: true } });
    if (clash) {
      throw new ConflictException(
        clash.schoolId === schoolId ? 'That domain is already on this school' : 'That domain belongs to another school',
      );
    }

    await db.domain.create({
      data: { schoolId, hostname, type: 'CUSTOM', status: 'PENDING', isPrimary: false },
    });

    // Claim it on the host immediately. Doing this at `add` rather than at
    // `verify` means the certificate order starts while the school is still
    // editing DNS, so the domain is usually servable the moment the record
    // lands. A failure here is reported, never fatal: the row exists, and
    // `verify` re-attempts the attach.
    const attach = await this.hosting.attach(hostname);
    if (!attach.ok) {
      this.logger.warn(`Domain ${hostname} recorded but not attached: ${attach.detail}`);
    }
    return { ...(await this.list(schoolId)), attach };
  }

  /**
   * Looks the domain up in real DNS, confirms the host will actually serve it,
   * and only then marks it LIVE.
   *
   * Both halves are required. DNS alone gets you `DEPLOYMENT_NOT_FOUND` from
   * an edge that has no project for the name; an attach alone gets you a
   * certificate order that never completes. A domain marked LIVE while either
   * half is missing is worse than one left PENDING — the school's whole site
   * 404s and nothing in the product explains why.
   */
  async verify(schoolId: string, domainId: string) {
    const db = getPlatformPrisma();
    const domain = await db.domain.findFirst({ where: { id: domainId, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');

    const dnsCheck = await this.pointsHere(domain.hostname);

    // Re-attempt the attach before reading status: `add` may have run without
    // credentials, or against a hosting API that was briefly down.
    let hosting = await this.hosting.status(domain.hostname);
    if (hosting.state === 'not_attached') {
      await this.hosting.attach(domain.hostname);
      hosting = await this.hosting.status(domain.hostname);
    }

    // `unknown` means we hold no credentials and genuinely cannot tell. Failing
    // closed there would make the whole flow unusable on a deployment that
    // attaches domains by hand, so DNS is allowed to be sufficient — the
    // instructions already say the attach is the operator's job in that case.
    const hostingOk = hosting.state === 'ready' || hosting.state === 'unknown';
    const ok = dnsCheck.ok && hostingOk;

    await db.domain.update({
      where: { id: domain.id },
      data: { status: ok ? 'LIVE' : 'ERROR' },
    });
    // The resolver caches host→tenant; without this the domain keeps its old
    // answer for the length of the TTL after the status changes.
    await this.lookup.invalidate(domain.hostname);

    // 200 with ok:false — DNS not having propagated yet is the NORMAL first
    // outcome of this button, not a client error, and the operator needs the
    // detail to tell "wrong record" from "not propagated" from "not attached".
    return {
      ok,
      detail: ok
        ? dnsCheck.detail
        : [dnsCheck.ok ? null : dnsCheck.detail, hostingOk ? null : this.hostingDetail(hosting)]
            .filter(Boolean)
            .join(' '),
      dns: dnsCheck,
      hosting,
      ...(await this.list(schoolId)),
    };
  }

  private hostingDetail(h: HostingStatus): string {
    switch (h.state) {
      case 'not_attached':
        return 'The hosting project does not have this domain, so the edge has nothing to serve and no certificate can be issued.';
      case 'misconfigured':
        return h.detail;
      case 'unknown':
        return h.detail;
      case 'ready':
        return '';
    }
  }

  /**
   * Does this hostname actually resolve to us?
   *
   * Deliberately generous about HOW it points here, because there are several
   * correct answers and refusing the ones we did not print would strand
   * schools whose DNS is genuinely fine:
   *   - a CNAME to our ingress name (what we tell subdomains to do);
   *   - a CNAME that resolves to the same addresses as our ingress (a
   *     registrar that flattened the chain, or a school that pointed straight
   *     at the underlying host);
   *   - an A record holding the apex address we publish;
   *   - an A record matching whatever our ingress resolves to today.
   *
   * The last two matter because the apex instruction hands out a fixed IP
   * while the ingress name resolves to a rotating anycast set — comparing only
   * against the latter would fail every correctly-configured apex domain.
   */
  private async pointsHere(hostname: string): Promise<{ ok: boolean; detail: string }> {
    const target = this.env.INGRESS_CNAME_TARGET.toLowerCase();
    const apexIp = this.env.INGRESS_A_RECORD;
    const seen: string[] = [];

    try {
      const [cnames, aRecords, targetIps] = await Promise.all([
        dns.resolveCname(hostname).catch(() => [] as string[]),
        dns.resolve4(hostname).catch(() => [] as string[]),
        dns.resolve4(target).catch(() => [] as string[]),
      ]);

      for (const c of cnames) {
        const v = c.replace(/\.$/, '').toLowerCase();
        seen.push(`CNAME ${v}`);
        if (v === target) return { ok: true, detail: `CNAME → ${v}` };
      }

      // A flattened or indirect CNAME still counts if it lands where we live.
      if (cnames.length && targetIps.length) {
        const chainIps = await dns
          .resolve4(cnames[0].replace(/\.$/, ''))
          .catch(() => [] as string[]);
        if (chainIps.some((ip) => targetIps.includes(ip))) {
          return { ok: true, detail: `CNAME → ${cnames[0]} → ${chainIps.join(', ')}` };
        }
      }

      aRecords.forEach((a) => seen.push(`A ${a}`));
      if (aRecords.includes(apexIp)) return { ok: true, detail: `A → ${apexIp}` };
      if (aRecords.length && targetIps.length && aRecords.some((a) => targetIps.includes(a))) {
        return { ok: true, detail: `A → ${aRecords.join(', ')}` };
      }

      const expected = hostname.split('.').length === 2 ? `A ${apexIp}` : `CNAME ${target}`;
      return {
        ok: false,
        detail: seen.length
          ? `${hostname} currently resolves to ${seen.join(', ')} — expected ${expected}. DNS changes can take up to an hour to propagate.`
          : `${hostname} has no CNAME or A record yet. Add the record shown, then try again — propagation can take up to an hour.`,
      };
    } catch (e) {
      return { ok: false, detail: `Could not look up ${hostname}: ${(e as Error).message}` };
    }
  }

  /**
   * Which address the school's own emails and links use. Only a LIVE domain
   * can be promoted — making a PENDING one primary would put an unreachable
   * host into every invite email the school sends.
   */
  async setPrimary(schoolId: string, domainId: string) {
    const db = getPlatformPrisma();
    const domain = await db.domain.findFirst({ where: { id: domainId, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');
    if (domain.status !== 'LIVE') {
      throw new ApiError('VALIDATION', 'Verify the domain before making it primary.', 400, 'domainId');
    }
    await db.$transaction([
      db.domain.updateMany({ where: { schoolId }, data: { isPrimary: false } }),
      db.domain.update({ where: { id: domainId }, data: { isPrimary: true } }),
    ]);
    await this.lookup.invalidate(domain.hostname);
    return this.list(schoolId);
  }

  async remove(schoolId: string, domainId: string) {
    const db = getPlatformPrisma();
    const domain = await db.domain.findFirst({ where: { id: domainId, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');
    await db.domain.delete({ where: { id: domainId } });
    // Release it on the host too, or the hostname stays claimed by this project
    // and no other school (or the school itself, elsewhere) can ever take it.
    await this.hosting.detach(domain.hostname);
    await this.lookup.invalidate(domain.hostname);
    return this.list(schoolId);
  }
}
