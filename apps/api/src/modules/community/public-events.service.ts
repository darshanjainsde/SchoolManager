import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@skoolos/db';
import type { PublicEvent } from './community.dto';

@Injectable()
export class PublicEventsService {
  // Runs inside the caller's withTenant(hostSchoolId) transaction. RLS returns
  // the host's own rows (tenant_iso) OR any NETWORK+APPROVED row (read_network_events).
  async forHost(tx: TenantTx, hostSchoolId: string): Promise<PublicEvent[]> {
    const now = new Date();
    const rows = await tx.event.findMany({
      where: {
        status: 'APPROVED',
        OR: [{ scope: 'SCHOOL' }, { scope: 'NETWORK' }],
        AND: { OR: [{ endAt: { gte: now } }, { endAt: null, startAt: { gte: now } }] },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      coverUrl: e.coverUrl,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt ? e.endAt.toISOString() : null,
      venue: e.venue,
      scope: e.scope as 'SCHOOL' | 'NETWORK',
      originSchoolName: e.scope === 'NETWORK' ? e.originSchoolName : null,
      isHost: e.schoolId === hostSchoolId,
    }));
  }
}
