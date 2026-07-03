import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, resolveFeatures } from '@skoolos/db';
import { FeatureResolverService } from '../../features/internal/feature-resolver.service';

export interface StatsResponse {
  schools: { total: number; byTier: { BASIC: number; STANDARD: number; PRO: number }; live: number; suspended: number };
  domains: { live: number };
}

export interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
}

export interface SchoolDetail extends SchoolRow {
  domains: { hostname: string; status: string; isPrimary: boolean }[];
}

@Injectable()
export class OwnerSchoolsService {
  constructor(private readonly featureResolver: FeatureResolverService) {}

  async stats(): Promise<StatsResponse> {
    const db = getPlatformPrisma();
    const [byTier, live, suspended, total, liveDomains] = await Promise.all([
      db.school.groupBy({ by: ['tier'], _count: true }),
      db.school.count({ where: { status: 'LIVE' } }),
      db.school.count({ where: { status: 'SUSPENDED' } }),
      db.school.count(),
      db.domain.count({ where: { status: 'LIVE' } }),
    ]);
    const tierMap = { BASIC: 0, STANDARD: 0, PRO: 0 } as Record<'BASIC' | 'STANDARD' | 'PRO', number>;
    for (const g of byTier) tierMap[g.tier as 'BASIC' | 'STANDARD' | 'PRO'] = g._count;
    return { schools: { total, byTier: tierMap, live, suspended }, domains: { live: liveDomains } };
  }

  async list(): Promise<SchoolRow[]> {
    const db = getPlatformPrisma();
    const schools = await db.school.findMany({
      orderBy: { name: 'asc' },
      include: { domains: { where: { isPrimary: true }, take: 1 }, featureOverrides: true },
    });
    return schools.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      status: s.status,
      primaryDomain: s.domains[0]?.hostname ?? null,
      features: [...resolveFeatures(s.tier as 'BASIC' | 'STANDARD' | 'PRO', s.featureOverrides)],
    }));
  }

  async detail(id: string): Promise<SchoolDetail> {
    const db = getPlatformPrisma();
    const s = await db.school.findUnique({
      where: { id },
      include: { domains: true, featureOverrides: true },
    });
    if (!s) throw new NotFoundException(`School ${id} not found`);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      status: s.status,
      primaryDomain: s.domains.find((d) => d.isPrimary)?.hostname ?? null,
      features: [...resolveFeatures(s.tier as 'BASIC' | 'STANDARD' | 'PRO', s.featureOverrides)],
      domains: s.domains.map((d) => ({ hostname: d.hostname, status: d.status, isPrimary: d.isPrimary })),
    };
  }
}
