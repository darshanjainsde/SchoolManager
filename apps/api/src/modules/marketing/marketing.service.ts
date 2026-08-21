import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import type { MarketingConfig, MarketingLead } from '@skoolos/db';
import { MailService } from '../../common/mail/mail.service';
import { runInBackground } from '../../common/notifications/run-in-background';
import { CreateLeadDto, PublicMarketingConfig, UpdateMarketingConfigDto } from './marketing.dto';

/**
 * Platform-level marketing state for sckools.com: the owner-editable pricing/
 * contact config (singleton row) and the callback-request lead inbox.
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

  async listLeads(status?: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<MarketingLead[]> {
    const db = getPlatformPrisma();
    return db.marketingLead.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async setLeadStatus(id: string, status: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<MarketingLead> {
    const db = getPlatformPrisma();
    const lead = await db.marketingLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return db.marketingLead.update({ where: { id }, data: { status } });
  }
}
