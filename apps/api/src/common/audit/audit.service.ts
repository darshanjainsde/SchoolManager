import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

export interface AuditEntry {
  schoolId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Writes audit rows via the platform Prisma client so a tenant connection
 * (and its RLS rules) never blocks an audit insert.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async record(entry: AuditEntry): Promise<void> {
    try {
      await getPlatformPrisma().auditLog.create({
        data: {
          schoolId: entry.schoolId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: (entry.meta as never) ?? null,
        },
      });
    } catch (e) {
      // Audit failures must never break the request — log loudly instead.
      this.logger.error(`Failed to write audit entry: ${(e as Error).message}`);
    }
  }
}
