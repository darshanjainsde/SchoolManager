import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../../common/errors/api-error';
import { SchoolLookupService } from '../../tenancy';

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

  constructor(private readonly lookup: SchoolLookupService) {}

  private hostnameOk(hostname: string): boolean {
    return /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(hostname) && !hostname.endsWith('.');
  }

  /** The records a school's DNS admin must add, in their own words. */
  private instructions(hostname: string) {
    const target = this.env.INGRESS_CNAME_TARGET;
    const isApex = hostname.split('.').length === 2;
    return {
      // An apex (school.in) cannot hold a CNAME, so it needs an A record or
      // the registrar's ALIAS/ANAME flavour. Saying so up front avoids the
      // single most common failed onboarding.
      kind: isApex ? ('A' as const) : ('CNAME' as const),
      host: isApex ? '@' : hostname.split('.')[0],
      value: target,
      note: isApex
        ? `${hostname} is a root domain, which cannot hold a CNAME. Use your registrar's ALIAS/ANAME record pointing at ${target}, or the A record they publish for it.`
        : `Add a CNAME on "${hostname.split('.')[0]}" pointing at ${target}.`,
      alsoRequired: `Add ${hostname} to the hosting project as well — DNS alone does not issue the certificate.`,
    };
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
    return this.list(schoolId);
  }

  /**
   * Looks the domain up in real DNS and only then marks it LIVE.
   *
   * Accepts a CNAME to the ingress target, or A records matching the target's
   * own addresses — apex domains cannot CNAME, and refusing them would make
   * every "school.in" onboarding impossible.
   */
  async verify(schoolId: string, domainId: string) {
    const db = getPlatformPrisma();
    const domain = await db.domain.findFirst({ where: { id: domainId, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');

    const target = this.env.INGRESS_CNAME_TARGET;
    const checked = await this.pointsHere(domain.hostname, target);

    if (!checked.ok) {
      await db.domain.update({ where: { id: domain.id }, data: { status: 'ERROR' } });
      await this.lookup.invalidate(domain.hostname);
      // 200 with ok:false — DNS not having propagated yet is the NORMAL first
      // outcome of this button, not a client error, and the operator needs the
      // detail to tell "wrong record" from "not propagated".
      return { ok: false as const, detail: checked.detail, ...(await this.list(schoolId)) };
    }

    await db.domain.update({ where: { id: domain.id }, data: { status: 'LIVE' } });
    // The resolver caches host→tenant; without this the new domain 404s for
    // the length of the TTL after it starts working.
    await this.lookup.invalidate(domain.hostname);
    return { ok: true as const, detail: checked.detail, ...(await this.list(schoolId)) };
  }

  private async pointsHere(hostname: string, target: string): Promise<{ ok: boolean; detail: string }> {
    const seen: string[] = [];
    try {
      const cnames = await dns.resolveCname(hostname).catch(() => [] as string[]);
      for (const c of cnames) {
        const v = c.replace(/\.$/, '').toLowerCase();
        seen.push(`CNAME ${v}`);
        if (v === target.toLowerCase()) return { ok: true, detail: `CNAME → ${v}` };
      }

      // Apex fallback: compare the A records against the target's own.
      const [aRecords, targetA] = await Promise.all([
        dns.resolve4(hostname).catch(() => [] as string[]),
        dns.resolve4(target).catch(() => [] as string[]),
      ]);
      aRecords.forEach((a) => seen.push(`A ${a}`));
      if (aRecords.length && targetA.length && aRecords.some((a) => targetA.includes(a))) {
        return { ok: true, detail: `A → ${aRecords.join(', ')}` };
      }

      return {
        ok: false,
        detail: seen.length
          ? `${hostname} currently resolves to ${seen.join(', ')} — expected ${target}. DNS changes can take up to an hour to propagate.`
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
    await this.lookup.invalidate(domain.hostname);
    return this.list(schoolId);
  }
}
