import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

export interface StatsResponse {
  schools: { total: number; byTier: { BASIC: number; STANDARD: number; PRO: number }; live: number; suspended: number };
  domains: { live: number };
}

@Injectable()
export class OwnerSchoolsService {
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
}
