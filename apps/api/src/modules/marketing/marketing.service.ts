import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import type { LeadActivity, MarketingConfig, MarketingLead } from '@skoolos/db';
import { MailService } from '../../common/mail/mail.service';
import { runInBackground } from '../../common/notifications/run-in-background';
import {
  CreateLeadActivityDto,
  CreateLeadDto,
  LeadStatusValue,
  PublicMarketingConfig,
  UpdateLeadDto,
  UpdateMarketingConfigDto,
} from './marketing.dto';

/** Logging one of these counts as having reached the lead. NOTE does not. */
const CONTACT_KINDS = new Set(['CALL', 'WHATSAPP', 'EMAIL', 'MEETING']);

/** A lead plus the denormalised bits the pipeline board needs per card. */
export interface LeadListItem extends MarketingLead {
  activityCount: number;
  lastActivityAt: Date | null;
}

export interface LeadDetail extends MarketingLead {
  activities: LeadActivity[];
}

/**
 * Platform-level marketing state for sckools.com: the owner-editable pricing/
 * contact config (singleton row), and the callback-request lead pipeline with
 * its per-lead activity timeline.
 */
@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(private readonly mail: MailService) {}

  /** Returns the singleton config, creating it with defaults on first read. */
  async getConfigRow(): Promise<MarketingConfig> {
    const db = getPlatformPrisma();
    return db.marketingConfig.upsert({ where: { id: 'default' }, update: {}, create: {} });
  }

  async getPublicConfig(): Promise<PublicMarketingConfig> {
    const c = await this.getConfigRow();
    return {
      prices: {
        basic: { usd: c.priceBasicUsd, inr: c.priceBasicInr },
        standard: { usd: c.priceStdUsd, inr: c.priceStdInr },
        pro: { usd: c.priceProUsd, inr: c.priceProInr },
      },
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
    };
  }

  async updateConfig(dto: UpdateMarketingConfigDto): Promise<MarketingConfig> {
    const db = getPlatformPrisma();
    const data = { ...dto, contactPhone: dto.contactPhone ?? '' };
    return db.marketingConfig.upsert({ where: { id: 'default' }, update: data, create: data });
  }

  async createLead(dto: CreateLeadDto): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const lead = await db.marketingLead.create({
      data: {
        name: dto.name?.trim() || null,
        phone: dto.phone.trim(),
        email: dto.email?.trim() || null,
        school: dto.school?.trim() || null,
        interest: dto.interest?.trim() || null,
        source: dto.source,
      },
    });
    // Notification is best-effort: the lead is already stored either way.
    // runInBackground, not a bare void — on Vercel a floating promise can be
    // frozen the moment the response returns, silently losing the send.
    const config = await this.getConfigRow();
    runInBackground(
      () => this.mail.sendLeadNotification(config.contactEmail, lead),
      () => undefined,
    );
    return { ok: true };
  }

  /**
   * Pipeline listing. `q` matches name / phone / school / interest so the
   * console's one search box covers every way the owner remembers a lead.
   */
  async listLeads(status?: LeadStatusValue, q?: string): Promise<LeadListItem[]> {
    const db = getPlatformPrisma();
    const term = q?.trim();
    const rows = await db.marketingLead.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { phone: { contains: term, mode: 'insensitive' as const } },
                { school: { contains: term, mode: 'insensitive' as const } },
                { interest: { contains: term, mode: 'insensitive' as const } },
                { email: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Counted with an explicit groupBy over just these leads, not a relation
    // `_count` in the include above. Prisma compiles that form into a join
    // that aggregates the WHOLE LeadActivity table and filters afterwards; the
    // scoped groupBy rides the [leadId, createdAt] index instead. `_max`
    // rides along, so the card's "last touch" costs no second query.
    // See common/tenant-aggregates.spec.ts for why this shape is a rule.
    const ids = rows.map((r) => r.id);
    const stats = ids.length
      ? await db.leadActivity.groupBy({
          by: ['leadId'],
          where: { leadId: { in: ids } },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : [];
    const byLead = new Map(stats.map((s) => [s.leadId, s]));

    return rows.map((lead) => ({
      ...lead,
      activityCount: byLead.get(lead.id)?._count._all ?? 0,
      lastActivityAt: byLead.get(lead.id)?._max.createdAt ?? null,
    }));
  }

  /** One lead with its full timeline, oldest first (reading order). */
  async getLead(id: string): Promise<LeadDetail> {
    const db = getPlatformPrisma();
    const lead = await db.marketingLead.findUnique({
      where: { id },
      include: { activities: { orderBy: { createdAt: 'asc' } } },
    });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  /**
   * Partial update. A status change also appends a STAGE_CHANGE activity, so
   * the timeline records every move without the caller having to remember —
   * both writes go in one transaction so a move can never be logged twice or
   * lost half-way.
   */
  async updateLead(id: string, dto: UpdateLeadDto, actorId?: string): Promise<LeadDetail> {
    const db = getPlatformPrisma();
    const existing = await db.marketingLead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Lead ${id} not found`);

    const data: Record<string, unknown> = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.name !== undefined) data.name = dto.name.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.email !== undefined) data.email = dto.email.trim() || null;
    if (dto.school !== undefined) data.school = dto.school.trim() || null;
    if (dto.interest !== undefined) data.interest = dto.interest.trim() || null;
    if (dto.nextFollowUpAt !== undefined) {
      data.nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null;
    }

    // A no-op status "change" writes no activity — re-selecting the current
    // stage in the console must not litter the timeline.
    const moved = dto.status !== undefined && dto.status !== existing.status;

    await db.$transaction([
      db.marketingLead.update({ where: { id }, data }),
      ...(moved
        ? [
            db.leadActivity.create({
              data: {
                leadId: id,
                kind: 'STAGE_CHANGE' as const,
                fromStatus: existing.status,
                toStatus: dto.status,
                actorId: actorId ?? null,
              },
            }),
          ]
        : []),
    ]);

    return this.getLead(id);
  }

  /**
   * Appends a manually-logged activity. Contact kinds also stamp
   * `lastContactedAt`, which is what the "not touched in N days" surfacing in
   * the console keys off.
   */
  async addLeadActivity(id: string, dto: CreateLeadActivityDto, actorId?: string): Promise<LeadDetail> {
    const db = getPlatformPrisma();
    const existing = await db.marketingLead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Lead ${id} not found`);

    const now = new Date();
    await db.$transaction([
      db.leadActivity.create({
        data: {
          leadId: id,
          kind: dto.kind,
          body: dto.body?.trim() || null,
          actorId: actorId ?? null,
        },
      }),
      ...(CONTACT_KINDS.has(dto.kind)
        ? [db.marketingLead.update({ where: { id }, data: { lastContactedAt: now } })]
        : []),
    ]);

    return this.getLead(id);
  }

  /** Legacy status-only path, kept so older callers keep working. */
  async setLeadStatus(id: string, status: LeadStatusValue, actorId?: string): Promise<MarketingLead> {
    return this.updateLead(id, { status }, actorId);
  }
}
