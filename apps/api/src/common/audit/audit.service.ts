import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import type { AuditScope } from '@skoolos/db';

interface AuditEntry {
  scope: AuditScope;
  schoolId: string | null;
  actorId: string | null;
  actorType: 'user' | 'platform' | 'system';
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
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
          scope: entry.scope,
          schoolId: entry.schoolId,
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: (entry.metadata as never) ?? null,
        },
      });
    } catch (e) {
      // Audit failures must never break the request — log loudly instead.
      this.logger.error(`Failed to write audit entry: ${(e as Error).message}`);
    }
  }
}
