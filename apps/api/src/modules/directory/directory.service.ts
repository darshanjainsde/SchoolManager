import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

export interface DirectoryEntry {
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  host: string;
}

/**
 * Platform-level directory of LIVE schools for the launcher/landing page.
 * This is intentionally cross-tenant, non-tenant-scoped public data (school
 * name, slug, tier, primary host) — so it lives in a platform module and uses
 * getPlatformPrisma, NOT the tenant `public` module (which forbids it).
 */
@Injectable()
export class DirectoryService {
  async listLiveSchools(): Promise<DirectoryEntry[]> {
    const db = getPlatformPrisma();
    const schools = await db.school.findMany({
      where: { status: 'LIVE' },
      orderBy: { name: 'asc' },
      include: { domains: { where: { isPrimary: true }, take: 1 } },
    });
    return schools.map((s) => ({
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      host: s.domains[0]?.hostname ?? `${s.slug}.localhost`,
    }));
  }
}
