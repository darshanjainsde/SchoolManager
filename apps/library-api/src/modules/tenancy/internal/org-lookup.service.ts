export type OrgContext =
  | { kind: 'tenant'; orgId: string; orgSlug: string; hostname: string }
  | { kind: 'unknown'; hostname: string };

export interface OrgStore {
  findDomain(hostname: string): Promise<{ orgId: string; org: { slug: string } } | null>;
  findBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
}

export interface OrgCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

const TTL = 60;

export class OrgLookupService {
  constructor(
    private readonly store: OrgStore,
    private readonly cache: OrgCache,
    private readonly platformHost: string,
  ) {}

  async resolveByHostname(hostname: string): Promise<OrgContext> {
    const host = hostname.trim().toLowerCase().split(':')[0];
    if (!host) return { kind: 'unknown', hostname };

    const key = `libhost:${host}`;
    try {
      const cached = await this.cache.get(key);
      if (cached) {
        const { orgId, orgSlug } = JSON.parse(cached) as { orgId: string; orgSlug: string };
        return { kind: 'tenant', orgId, orgSlug, hostname: host };
      }
    } catch { /* cache is never a source of truth — fall through to the database */ }

    const domain = await this.store.findDomain(host);
    if (domain) return this.remember(key, domain.orgId, domain.org.slug, host);

    const suffix = `.${this.platformHost}`;
    if (host.endsWith(suffix)) {
      const slug = host.slice(0, -suffix.length);
      if (slug && !slug.includes('.')) {
        const org = await this.store.findBySlug(slug);
        if (org) return this.remember(key, org.id, org.slug, host);
      }
    }
    return { kind: 'unknown', hostname: host };
  }

  private async remember(key: string, orgId: string, orgSlug: string, hostname: string): Promise<OrgContext> {
    try { await this.cache.set(key, JSON.stringify({ orgId, orgSlug }), TTL); } catch { /* ignore */ }
    return { kind: 'tenant', orgId, orgSlug, hostname };
  }
}
