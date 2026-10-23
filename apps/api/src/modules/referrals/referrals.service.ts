import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { Prisma } from '@skoolos/db';
import type { MarketingConfig, Promoter, Referral, ReferralPayout, ReferralStatus } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../common/errors/api-error';
import { MailService } from '../../common/mail/mail.service';
import { runInBackground } from '../../common/notifications/run-in-background';
import { ReferralMail } from './referral-mail';
import { addDays, canMove, ladderOf, omit, phoneKey, promoterCode, rewardMinor, schoolKey, suggestedPct, tdsMinor, HOLDING, STAGE_ORDER } from './referral-rules';
import type { AddPromoterDto, CreateReferralDto, MarkPaidDto, PayoutDetailsDto, ReferralSettingsDto, ReferralStageDto, SetCommissionDto, SetPromoterStatusDto, UpdatePromoterDto } from './referrals.dto';

export interface ReferralSettings {
  ladder: Record<string, number>;
  capMinor: number;
  payoutDays: number;
  attributionDays: number;
  tdsPct: number;
}

export interface DuplicateHit {
  kind: 'referral' | 'lead' | 'school' | 'lapsed';
  /** `referral`: held by the asking promoter themselves. */
  mine?: boolean;
  /** `lapsed`: the stale LOGGED/ACCEPTED referral that can be retired. */
  referralId?: string;
  on?: Date;
}

/** The lead stage a referral stage implies, so the Leads board and the Referrals tab never disagree. */
const LEAD_STAGE: Partial<Record<ReferralStatus, 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DEMO' | 'WON' | 'LOST'>> = {
  ACCEPTED: 'NEW', CONTACTED: 'CONTACTED', DEMO_DONE: 'DEMO', PROPOSAL_SENT: 'QUALIFIED', WON: 'WON', LIVE: 'WON', PAYOUT_DUE: 'WON', PAID: 'WON', LOST: 'LOST', REJECTED: 'LOST',
};

export function siteUrl(): string {
  const env = loadEnv();
  return env.PLATFORM_HOST === 'localhost' || env.PLATFORM_HOST.endsWith('.localhost') ? `http://${env.PLATFORM_HOST}:3000` : `https://${env.PLATFORM_HOST}`;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  readonly mail: ReferralMail;
  constructor(mailService: MailService) {
    this.mail = new ReferralMail(mailService, siteUrl());
  }

  private get db() { return getPlatformPrisma(); }

  // ─── Settings ──────────────────────────────────────────────────────────────

  async settings(): Promise<ReferralSettings> {
    const c = await this.db.marketingConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    return this.settingsOf(c);
  }
  settingsOf(c: MarketingConfig): ReferralSettings {
    return { ladder: ladderOf(c.referralLadder), capMinor: c.referralCapMinor, payoutDays: c.referralPayoutDays, attributionDays: c.referralAttributionDays, tdsPct: c.referralTdsPct };
  }
  async updateSettings(dto: ReferralSettingsDto): Promise<ReferralSettings> {
    const data: Prisma.MarketingConfigUpdateInput = {};
    if (dto.ladder) data.referralLadder = ladderOf(dto.ladder) as unknown as Prisma.InputJsonValue;
    if (dto.capMinor !== undefined) data.referralCapMinor = dto.capMinor;
    if (dto.payoutDays !== undefined) data.referralPayoutDays = dto.payoutDays;
    if (dto.attributionDays !== undefined) data.referralAttributionDays = dto.attributionDays;
    if (dto.tdsPct !== undefined) data.referralTdsPct = dto.tdsPct;
    const c = await this.db.marketingConfig.upsert({ where: { id: 'default' }, update: data, create: { id: 'default', ...(data as Prisma.MarketingConfigCreateInput) } });
    return this.settingsOf(c);
  }
  private async ownerEmail(): Promise<string> {
    const c = await this.db.marketingConfig.findUnique({ where: { id: 'default' }, select: { contactEmail: true } });
    return c?.contactEmail || 'admin@sckools.com';
  }

  // ─── Promoters ─────────────────────────────────────────────────────────────

  requireActive(p: Promoter): void {
    if (p.status !== 'ACTIVE') throw new ApiError('PROMOTER_SUSPENDED', p.statusReason || 'Your account is paused. Write to admin@sckools.com.', 403);
  }

  async uniqueCode(name: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = promoterCode(name, Math.floor(Math.random() * 1e6));
      if (!(await this.db.promoter.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    return `SK${Date.now().toString(36).toUpperCase().slice(-6)}`;
  }

  /** The promoter's own view: profile, rate, figures, and whether anything is pending. */
  async me(p: Promoter) {
    const [refs, payouts, task, settings] = await Promise.all([
      this.db.referral.findMany({ where: { promoterId: p.id }, select: { status: true, rewardMinor: true } }),
      this.db.referralPayout.findMany({ where: { promoterId: p.id }, select: { grossMinor: true, netMinor: true, status: true } }),
      this.db.referralTask.findFirst({ where: { promoterId: p.id, kind: 'COMMISSION', status: 'OPEN' }, select: { createdAt: true } }),
      this.settings(),
    ]);
    const live = refs.filter((r) => ['LIVE', 'PAYOUT_DUE', 'PAID'].includes(r.status)).length;
    const inProgress = refs.filter((r) => !['LIVE', 'PAYOUT_DUE', 'PAID', 'REJECTED', 'LOST'].includes(r.status)).length;
    const safe = omit(p, ['pan', 'bankAccount']);
    return {
      ...safe,
      bankAccountMasked: p.bankAccount ? `••••${p.bankAccount.slice(-4)}` : null,
      panMasked: p.pan ? `${p.pan.slice(0, 2)}•••••${p.pan.slice(-2)}` : null,
      commissionRequestedAt: task?.createdAt ?? null,
      questionnaireComplete: !!(p.who && p.expect),
      payoutDetailsComplete: !!p.payoutDetailsAt,
      figures: {
        referred: refs.length,
        inProgress,
        live,
        earnedMinor: payouts.reduce((a, y) => a + y.grossMinor, 0),
        paidMinor: payouts.filter((y) => y.status === 'PAID').reduce((a, y) => a + y.netMinor, 0),
      },
      attributionDays: settings.attributionDays,
      payoutDays: settings.payoutDays,
    };
  }

  async updateProfile(p: Promoter, dto: UpdatePromoterDto): Promise<Promoter> {
    const data: Prisma.PromoterUpdateInput = {};
    for (const k of ['name', 'city', 'who', 'expect', 'areas', 'know', 'schoolsInMind', 'hasGst'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k];
    }
    const next = { ...p } as Record<string, unknown>;
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) next[k] = v;
    if (next.who && next.expect && !p.questionnaireAt) data.questionnaireAt = new Date();
    return this.db.promoter.update({ where: { id: p.id }, data });
  }

  async requestCommission(p: Promoter): Promise<{ requestedAt: Date }> {
    this.requireActive(p);
    if (!p.who || !p.expect) throw new ApiError('VALIDATION', 'Answer the questionnaire first; it decides your rate.', 400, 'expect');
    const open = await this.db.referralTask.findFirst({ where: { promoterId: p.id, kind: 'COMMISSION', status: 'OPEN' } });
    if (open) return { requestedAt: open.createdAt };
    const t = await this.db.referralTask.create({ data: { kind: 'COMMISSION', promoterId: p.id } });
    runInBackground(async () => { await this.mail.ownerTask(await this.ownerEmail(), `${p.name} asked for a commission rate`, `${p.who}, expects ${p.expect} schools in ${p.areas || p.city || 'their area'}.`); }, () => undefined);
    return { requestedAt: t.createdAt };
  }

  async savePayoutDetails(p: Promoter, dto: PayoutDetailsDto): Promise<Promoter> {
    this.requireActive(p);
    if (!dto.upi && !(dto.bankAccount && dto.ifsc)) throw new ApiError('VALIDATION', 'Give a UPI id, or a bank account with its IFSC.', 400, 'upi');
    const updated = await this.db.promoter.update({
      where: { id: p.id },
      data: { payeeName: dto.payeeName, pan: dto.pan, bankAccount: dto.bankAccount ?? null, ifsc: dto.ifsc ?? null, upi: dto.upi ?? null, gstin: dto.gstin ?? null, address: dto.address ?? null, payoutDetailsAt: new Date(), kycVerifiedAt: null },
    });
    // One open KYC task at a time; a re-save re-opens it (the details changed).
    const open = await this.db.referralTask.findFirst({ where: { promoterId: p.id, kind: 'KYC', status: 'OPEN' } });
    if (!open) await this.db.referralTask.create({ data: { kind: 'KYC', promoterId: p.id } });
    return updated;
  }

  // Owner side

  async listPromoters(f: { q?: string; city?: string; status?: string }) {
    const where: Prisma.PromoterWhereInput = { status: { not: 'REMOVED' } };
    if (f.status && ['ACTIVE', 'SUSPENDED', 'REMOVED'].includes(f.status)) where.status = f.status as Promoter['status'];
    if (f.city) where.city = { equals: f.city, mode: 'insensitive' };
    if (f.q) where.OR = [{ name: { contains: f.q, mode: 'insensitive' } }, { email: { contains: f.q, mode: 'insensitive' } }, { phoneE164: { contains: phoneKey(f.q) || '∅' } }, { code: { contains: f.q.toUpperCase() } }];
    const rows = await this.db.promoter.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { referrals: { select: { status: true } }, payouts: { select: { grossMinor: true, netMinor: true, status: true } }, tasks: { where: { status: 'OPEN' }, select: { kind: true } } },
    });
    return rows.map(({ pan, bankAccount, ifsc, upi, gstin, address, referrals, payouts, tasks, ...p }) => ({
      ...p,
      panMasked: pan ? `${pan.slice(0, 2)}•••••${pan.slice(-2)}` : null,
      bankAccountMasked: bankAccount ? `••••${bankAccount.slice(-4)}` : null,
      ifsc, upi, gstin, address,
      referred: referrals.length,
      live: referrals.filter((r) => ['LIVE', 'PAYOUT_DUE', 'PAID'].includes(r.status)).length,
      earnedMinor: payouts.reduce((a, y) => a + y.grossMinor, 0),
      paidMinor: payouts.filter((y) => y.status === 'PAID').reduce((a, y) => a + y.netMinor, 0),
      openTasks: tasks.map((t) => t.kind),
    }));
  }

  async addPromoter(dto: AddPromoterDto): Promise<Promoter> {
    const email = dto.email?.toLowerCase() ?? null;
    const phoneE164 = dto.phone ? e164(dto.phone) : null;
    if (!email && !phoneE164) throw new ApiError('VALIDATION', 'An email or a WhatsApp number is needed to sign in with.', 400, 'email');
    const clash = await this.db.promoter.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phoneE164 ? [{ phoneE164 }] : [])] } });
    if (clash) throw new ApiError('VALIDATION', `${clash.name} already has an account with that ${clash.email === email ? 'email' : 'number'}.`, 409, 'email');
    const p = await this.db.promoter.create({ data: { code: await this.uniqueCode(dto.name), name: dto.name, email, phoneE164, city: dto.city ?? null } });
    if (email) runInBackground(() => this.mail.loginLink(email, p.name), () => undefined);
    return p;
  }

  async setCommission(id: string, dto: SetCommissionDto): Promise<Promoter> {
    // The cap is stored as a definite number: 0 is "no cap", and an omitted
    // cap takes the platform default at the moment the rate is set, so what the
    // promoter is told today is what the payout uses later, whatever Settings says then.
    const cap = dto.capMinor === undefined || dto.capMinor === null ? (await this.settings()).capMinor : dto.capMinor;
    const p = await this.db.promoter.update({
      where: { id },
      data: { commissionPct: dto.pct, commissionCapMinor: cap, commissionNote: dto.note || null, commissionSetAt: new Date() },
    }).catch(() => { throw new NotFoundException('Promoter not found'); });
    await this.db.referralTask.updateMany({ where: { promoterId: id, kind: 'COMMISSION', status: 'OPEN' }, data: { status: 'DONE', doneAt: new Date() } });
    if (p.email) runInBackground(() => this.mail.commissionSet(p.email!, p.name, dto.pct, cap || null, dto.note || null), () => undefined);
    return p;
  }

  async setPromoterStatus(id: string, dto: SetPromoterStatusDto): Promise<Promoter> {
    const data: Prisma.PromoterUpdateInput = { status: dto.status, statusReason: dto.status === 'ACTIVE' ? null : dto.reason ?? null };
    // A paused or closed account's tokens die now, not at expiry.
    if (dto.status !== 'ACTIVE') data.tokenVersion = { increment: 1 };
    const p = await this.db.promoter.update({ where: { id }, data }).catch(() => { throw new NotFoundException('Promoter not found'); });
    if (dto.status !== 'ACTIVE') await this.db.referralTask.updateMany({ where: { promoterId: id, status: 'OPEN' }, data: { status: 'DONE', doneAt: new Date() } });
    if (p.email) runInBackground(() => this.mail.statusChanged(p.email!, dto.status, dto.reason ?? null), () => undefined);
    return p;
  }

  async verifyKyc(id: string): Promise<Promoter> {
    const p = await this.db.promoter.update({ where: { id }, data: { kycVerifiedAt: new Date() } }).catch(() => { throw new NotFoundException('Promoter not found'); });
    await this.db.referralTask.updateMany({ where: { promoterId: id, kind: 'KYC', status: 'OPEN' }, data: { status: 'DONE', doneAt: new Date() } });
    return p;
  }

  async sendLoginLink(id: string): Promise<{ ok: true }> {
    const p = await this.db.promoter.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Promoter not found');
    if (!p.email) throw new ApiError('VALIDATION', 'This promoter has no email; they sign in by WhatsApp code.', 400, 'email');
    await this.mail.loginLink(p.email, p.name);
    return { ok: true };
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────

  /**
   * Is this school already with us? First accepted wins, for the attribution
   * window; a school already in the lead pipeline or already live is never
   * referrable. Rejected and lost referrals do not hold; a lapsed LOGGED/ACCEPTED
   * one is reported so the caller can retire it. Never names the other promoter.
   */
  async duplicateOf(sKey: string, pKey: string, name: string, opts: { excludePromoterId?: string; excludeReferralId?: string } = {}): Promise<DuplicateHit | null> {
    const now = new Date();
    const held = await this.db.referral.findFirst({
      where: {
        AND: [
          { OR: [{ schoolKey: sKey }, ...(pKey.length >= 7 ? [{ contactPhoneKey: pKey }] : [])] },
          { status: { in: HOLDING } },
          ...(opts.excludeReferralId ? [{ id: { not: opts.excludeReferralId } }] : []),
        ],
      },
      select: { id: true, promoterId: true, status: true, attributionUntil: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (held) {
      const lapsed = ['LOGGED', 'ACCEPTED'].includes(held.status) && held.attributionUntil < now;
      if (lapsed) return { kind: 'lapsed', referralId: held.id, on: held.createdAt };
      return { kind: 'referral', mine: held.promoterId === opts.excludePromoterId, on: held.createdAt };
    }
    // Leads store the phone as typed, so the comparison is done on normalised keys here, not in SQL.
    const nameKey = sKey.split('|')[0];
    const leads = await this.db.marketingLead.findMany({
      where: { status: { notIn: ['LOST', 'CLOSED'] }, createdAt: { gt: addDays(now, -180) }, referral: null },
      select: { phone: true, school: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const lead = leads.find((l) => (pKey.length >= 7 && phoneKey(l.phone) === pKey) || (!!l.school && schoolKey(l.school, '').split('|')[0] === nameKey));
    if (lead) return { kind: 'lead', on: lead.createdAt };
    const school = await this.db.school.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, status: { not: 'SUSPENDED' } }, select: { id: true } });
    if (school) return { kind: 'school' };
    return null;
  }

  /** The words a promoter reads for a duplicate. No other promoter is ever named. */
  reasonFor(dup: DuplicateHit): string {
    if (dup.kind === 'referral') return dup.mine ? 'You have already referred this school.' : `Already referred by another promoter on ${fmt(dup.on!)}.`;
    if (dup.kind === 'lead') return 'This school is already in touch with Sckools.';
    return 'This school is already live on Sckools.';
  }

  async createReferral(p: Promoter, dto: CreateReferralDto, opts: { viaLink?: boolean } = {}): Promise<Referral> {
    this.requireActive(p);
    const settings = await this.settings();
    const sKey = schoolKey(dto.schoolName, dto.city);
    const pKey = phoneKey(dto.contactPhone);
    let dup = await this.duplicateOf(sKey, pKey, dto.schoolName, { excludePromoterId: p.id });
    if (dup?.kind === 'lapsed') {
      // The earlier log was never accepted inside its window: retire it so the school is free again.
      await this.db.referral.update({ where: { id: dup.referralId! }, data: { status: 'LOST', statusReason: 'Lapsed: not accepted within the attribution window.', events: { create: { actor: 'SYSTEM', toStatus: 'LOST', body: 'Lapsed: not accepted within the attribution window.' } } } });
      dup = null;
    }
    const now = new Date();
    const base = {
      promoterId: p.id, schoolName: dto.schoolName, schoolKey: sKey, city: dto.city, area: dto.area || null, studentsApprox: dto.studentsApprox ?? null, board: dto.board || null,
      contactName: dto.contactName, contactRole: dto.contactRole || null, contactPhone: dto.contactPhone, contactPhoneKey: pKey, contactEmail: dto.contactEmail || null,
      planInterest: dto.planInterest || null, howKnown: dto.howKnown || null, consent: dto.consent, viaLink: !!opts.viaLink, attributionUntil: addDays(now, settings.attributionDays),
    };
    const rejected = (reason: string) => this.db.referral.create({
      data: { ...base, status: 'REJECTED', statusReason: reason, events: { create: [{ actor: 'PROMOTER', toStatus: 'LOGGED' }, { actor: 'SYSTEM', fromStatus: 'LOGGED', toStatus: 'REJECTED', body: reason }] } },
    });
    if (dup) return rejected(this.reasonFor(dup));
    let r: Referral;
    try {
      r = await this.db.referral.create({
        data: { ...base, status: 'LOGGED', events: { create: [{ actor: 'PROMOTER', toStatus: 'LOGGED' }] }, tasks: { create: { kind: 'REFERRAL', promoterId: p.id } } },
      });
    } catch (e) {
      // Two promoters logged the same school in the same instant: the partial
      // unique index on a held schoolKey lets exactly one through.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return rejected('Already referred by another promoter just now.');
      throw e;
    }
    runInBackground(async () => { await this.mail.ownerTask(await this.ownerEmail(), `New referral: ${dto.schoolName}, ${dto.city}`, `${p.name} referred ${dto.contactName}${dto.contactRole ? ` (${dto.contactRole})` : ''}, ${dto.contactPhone}. Accept it to put the lead in your pipeline.`); }, () => undefined);
    return r;
  }

  /** A school that came through ?ref=CODE on the quote journey: logged for the promoter, consent implied by the school asking itself. */
  async attributeLead(code: string, lead: { id: string; name: string | null; phone: string; email: string | null; school: string | null; interest: string | null }): Promise<void> {
    const p = await this.db.promoter.findUnique({ where: { code: code.toUpperCase() } });
    if (!p || p.status !== 'ACTIVE' || !lead.school) return;
    const settings = await this.settings();
    const sKey = schoolKey(lead.school, '');
    const pKey = phoneKey(lead.phone);
    const dup = await this.db.referral.findFirst({ where: { OR: [{ contactPhoneKey: pKey }, { schoolKey: { startsWith: sKey.split('|')[0] + '|' } }], status: { in: HOLDING } } });
    if (dup) return;
    await this.db.referral.create({
      data: {
        promoterId: p.id, leadId: lead.id, schoolName: lead.school, schoolKey: sKey, city: '', contactName: lead.name || 'From the website', contactPhone: lead.phone, contactPhoneKey: pKey, contactEmail: lead.email,
        planInterest: lead.interest, consent: true, viaLink: true, status: 'ACCEPTED', attributionUntil: addDays(new Date(), settings.attributionDays),
        events: { create: [{ actor: 'SYSTEM', toStatus: 'LOGGED', body: `Came through the promoter's link (${p.code}).` }, { actor: 'SYSTEM', fromStatus: 'LOGGED', toStatus: 'ACCEPTED' }] },
      },
    });
  }

  async listForPromoter(p: Promoter) {
    const rows = await this.db.referral.findMany({ where: { promoterId: p.id }, orderBy: { createdAt: 'desc' }, include: { events: { orderBy: { createdAt: 'asc' } }, payout: true } });
    return rows.map((r) => this.promoterView(r, p));
  }
  async getForPromoter(p: Promoter, id: string) {
    const r = await this.db.referral.findFirst({ where: { id, promoterId: p.id }, include: { events: { orderBy: { createdAt: 'asc' } }, payout: true } });
    if (!r) throw new NotFoundException('Referral not found');
    return this.promoterView(r, p);
  }
  private promoterView(r: Referral & { events: { actor: string; fromStatus: ReferralStatus | null; toStatus: ReferralStatus | null; body: string | null; createdAt: Date }[]; payout: ReferralPayout | null }, p: Promoter) {
    const rest = omit(r, ['contactPhoneKey', 'schoolKey', 'invoiceMinor', 'wonSchoolId']);
    return {
      ...rest,
      lapsed: ['LOGGED', 'ACCEPTED'].includes(r.status) && r.attributionUntil < new Date(),
      willEarnMinor: r.rewardMinor ?? null,
      rateKnown: !!p.commissionPct,
      payout: r.payout ? { grossMinor: r.payout.grossMinor, tdsMinor: r.payout.tdsMinor, netMinor: r.payout.netMinor, dueOn: r.payout.dueOn, status: r.payout.status, paidOn: r.payout.paidOn, utr: r.payout.utr } : null,
      // Owner-side notes stay owner-side; the promoter sees stage moves and their own notes.
      events: r.events.filter((e) => e.actor !== 'OWNER' || e.toStatus).map((e) => ({ actor: e.actor, fromStatus: e.fromStatus, toStatus: e.toStatus, body: e.actor === 'OWNER' ? (e.toStatus === 'REJECTED' || e.toStatus === 'LOST' ? e.body : null) : e.body, at: e.createdAt })),
    };
  }

  async addPromoterNote(p: Promoter, id: string, body: string) {
    this.requireActive(p);
    const r = await this.db.referral.findFirst({ where: { id, promoterId: p.id }, select: { id: true } });
    if (!r) throw new NotFoundException('Referral not found');
    await this.db.referralEvent.create({ data: { referralId: id, actor: 'PROMOTER', body } });
    return this.getForPromoter(p, id);
  }

  // Owner side

  async listReferrals(f: { q?: string; promoterId?: string; city?: string; status?: string }) {
    const where: Prisma.ReferralWhereInput = {};
    if (f.promoterId) where.promoterId = f.promoterId;
    if (f.city) where.city = { equals: f.city, mode: 'insensitive' };
    if (f.status && (STAGE_ORDER as string[]).concat(['REJECTED', 'LOST']).includes(f.status)) where.status = f.status as ReferralStatus;
    if (f.q) where.OR = [{ schoolName: { contains: f.q, mode: 'insensitive' } }, { contactName: { contains: f.q, mode: 'insensitive' } }, { contactPhoneKey: { contains: phoneKey(f.q) || '∅' } }, { city: { contains: f.q, mode: 'insensitive' } }];
    const rows = await this.db.referral.findMany({ where, orderBy: { createdAt: 'desc' }, include: { promoter: { select: { id: true, name: true, code: true, commissionPct: true, commissionCapMinor: true } }, payout: true, events: { orderBy: { createdAt: 'asc' } } } });
    return rows.map((r) => ({ ...r, lapsed: ['LOGGED', 'ACCEPTED'].includes(r.status) && r.attributionUntil < new Date() }));
  }

  async listTasks() {
    const tasks = await this.db.referralTask.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, include: { promoter: true, referral: { include: { events: { orderBy: { createdAt: 'asc' } } } } } });
    const settings = await this.settings();
    return Promise.all(tasks.map(async (t) => {
      const { pan, bankAccount, ...p } = t.promoter;
      const r = t.referral;
      const duplicate = t.kind === 'REFERRAL' && r ? await this.duplicateOf(r.schoolKey, r.contactPhoneKey, r.schoolName, { excludePromoterId: r.promoterId, excludeReferralId: r.id }) : null;
      return {
        ...t,
        promoter: { ...p, panMasked: pan ? `${pan.slice(0, 2)}•••••${pan.slice(-2)}` : null, ...(t.kind === 'KYC' ? { pan, bankAccount } : {}) },
        suggestedPct: t.kind === 'COMMISSION' ? suggestedPct(settings.ladder, t.promoter.expect) ?? 10 : null,
        suggestedCapMinor: settings.capMinor,
        duplicate,
        lapsed: !!r && ['LOGGED', 'ACCEPTED'].includes(r.status) && r.attributionUntil < new Date(),
      };
    }));
  }

  async accept(id: string): Promise<Referral> {
    const r = await this.db.referral.findUnique({ where: { id }, include: { promoter: true } });
    if (!r) throw new NotFoundException('Referral not found');
    if (r.status !== 'LOGGED') throw new ApiError('REFERRAL_BAD_TRANSITION', `This referral is ${r.status.toLowerCase().replace('_', ' ')}, not waiting.`, 409);
    if (r.attributionUntil < new Date()) throw new ApiError('REFERRAL_BAD_TRANSITION', `This referral lapsed on ${fmt(r.attributionUntil)}; the school may be referred again.`, 409);
    const dup = await this.duplicateOf(r.schoolKey, r.contactPhoneKey, r.schoolName, { excludePromoterId: r.promoterId, excludeReferralId: r.id });
    if (dup && dup.kind !== 'lapsed') throw new ApiError('REFERRAL_BAD_TRANSITION', `${this.reasonFor(dup)} Reject this one with that reason.`, 409);
    const lead = await this.db.marketingLead.create({
      data: { name: r.contactName, phone: r.contactPhone, email: r.contactEmail, school: r.schoolName, interest: r.planInterest, source: `referral:${r.promoter.code}`, activities: { create: { kind: 'NOTE', body: `Referred by ${r.promoter.name} (${r.promoter.code}). ${r.howKnown ? `How they know them: ${r.howKnown}` : ''}`.trim() } } },
    });
    const out = await this.db.referral.update({ where: { id }, data: { status: 'ACCEPTED', leadId: lead.id, events: { create: { actor: 'OWNER', fromStatus: 'LOGGED', toStatus: 'ACCEPTED' } } } });
    await this.db.referralTask.updateMany({ where: { referralId: id, status: 'OPEN' }, data: { status: 'DONE', doneAt: new Date() } });
    if (r.promoter.email) runInBackground(() => this.mail.accepted(r.promoter.email!, r.schoolName), () => undefined);
    return out;
  }

  async reject(id: string, reason: string): Promise<Referral> {
    const r = await this.db.referral.findUnique({ where: { id }, include: { promoter: true } });
    if (!r) throw new NotFoundException('Referral not found');
    if (!canMove(r.status, 'REJECTED')) throw new ApiError('REFERRAL_BAD_TRANSITION', 'This referral is already closed.', 409);
    const out = await this.db.referral.update({ where: { id }, data: { status: 'REJECTED', statusReason: reason, events: { create: { actor: 'OWNER', fromStatus: r.status, toStatus: 'REJECTED', body: reason } } } });
    await this.db.referralTask.updateMany({ where: { referralId: id, status: 'OPEN' }, data: { status: 'DONE', doneAt: new Date() } });
    if (r.leadId) await this.moveLead(r.leadId, 'LOST');
    if (r.promoter.email) runInBackground(() => this.mail.rejected(r.promoter.email!, r.schoolName, reason), () => undefined);
    return out;
  }

  async setStage(id: string, dto: ReferralStageDto): Promise<Referral> {
    const r = await this.db.referral.findUnique({ where: { id }, include: { promoter: true, payout: true } });
    if (!r) throw new NotFoundException('Referral not found');
    if (dto.status === 'ACCEPTED') return this.accept(id);
    if (!canMove(r.status, dto.status)) throw new ApiError('REFERRAL_BAD_TRANSITION', `Cannot move a ${r.status.toLowerCase().replace('_', ' ')} referral to ${dto.status.toLowerCase().replace('_', ' ')}.`, 409);
    if (dto.status === 'LIVE') return this.markLive(r, dto);
    const out = await this.db.referral.update({
      where: { id },
      data: { status: dto.status, statusReason: dto.status === 'LOST' ? dto.reason ?? null : r.statusReason, wonSchoolId: dto.wonSchoolId ?? r.wonSchoolId, events: { create: { actor: 'OWNER', fromStatus: r.status, toStatus: dto.status, body: dto.reason ?? null } } },
    });
    if (r.leadId && LEAD_STAGE[dto.status]) await this.moveLead(r.leadId, LEAD_STAGE[dto.status]!);
    return out;
  }

  /** The money step: the school has paid its first invoice. Needs the rate and the invoice; creates the one payout. */
  private async markLive(r: Referral & { promoter: Promoter; payout: ReferralPayout | null }, dto: ReferralStageDto): Promise<Referral> {
    if (!r.promoter.commissionPct) throw new ApiError('REFERRAL_RATE_NOT_SET', `${r.promoter.name} has no commission rate yet. Set it under Promoters first.`, 409);
    if (!dto.invoiceMinor) throw new ApiError('REFERRAL_INVOICE_REQUIRED', "The school's first-year invoice amount is needed to work out the reward.", 400, 'invoiceMinor');
    if (r.payout) throw new ApiError('REFERRAL_BAD_TRANSITION', 'This referral already has a payout.', 409);
    const settings = await this.settings();
    // The promoter's cap is definite since setCommission; a row from before that stores null and takes the platform default. 0 is no cap.
    const capMinor = r.promoter.commissionCapMinor === null ? settings.capMinor : r.promoter.commissionCapMinor;
    const gross = rewardMinor(dto.invoiceMinor, r.promoter.commissionPct, capMinor || null);
    const tds = tdsMinor(gross, settings.tdsPct);
    const now = new Date();
    const dueOn = addDays(now, settings.payoutDays);
    const out = await this.db.referral.update({
      where: { id: r.id },
      data: {
        status: 'PAYOUT_DUE', invoiceMinor: dto.invoiceMinor, rewardMinor: gross, liveAt: now, wonSchoolId: dto.wonSchoolId ?? r.wonSchoolId,
        events: { create: [{ actor: 'OWNER', fromStatus: r.status, toStatus: 'LIVE', body: dto.reason ?? null }, { actor: 'SYSTEM', fromStatus: 'LIVE', toStatus: 'PAYOUT_DUE', body: `Reward ${money(gross)} due on ${fmt(dueOn)}.` }] },
        payout: { create: { promoterId: r.promoterId, grossMinor: gross, tdsMinor: tds, netMinor: gross - tds, dueOn } },
      },
    }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ApiError('REFERRAL_BAD_TRANSITION', 'This referral already has a payout.', 409);
      throw e;
    });
    if (r.leadId) await this.moveLead(r.leadId, 'WON');
    const detailsMissing = !r.promoter.payoutDetailsAt;
    if (detailsMissing) {
      const open = await this.db.referralTask.findFirst({ where: { promoterId: r.promoterId, kind: 'KYC', status: 'OPEN' } });
      if (!open) await this.db.referralTask.create({ data: { kind: 'KYC', promoterId: r.promoterId, referralId: r.id, note: 'Payout due; no payout details yet.' } });
    }
    if (r.promoter.email) runInBackground(() => this.mail.live(r.promoter.email!, r.schoolName, gross, dueOn, detailsMissing), () => undefined);
    return out;
  }

  private async moveLead(leadId: string, status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DEMO' | 'WON' | 'LOST'): Promise<void> {
    const lead = await this.db.marketingLead.findUnique({ where: { id: leadId }, select: { status: true } });
    if (!lead || lead.status === status) return;
    await this.db.marketingLead.update({ where: { id: leadId }, data: { status, activities: { create: { kind: 'STAGE_CHANGE', fromStatus: lead.status, toStatus: status, body: 'Moved from the Referrals tab.' } } } });
  }

  // ─── Payouts ───────────────────────────────────────────────────────────────

  async listPayouts(f: { status?: string } = {}) {
    const where: Prisma.ReferralPayoutWhereInput = {};
    if (f.status && ['DUE', 'PAID', 'ON_HOLD'].includes(f.status)) where.status = f.status as ReferralPayout['status'];
    const rows = await this.db.referralPayout.findMany({ where, orderBy: [{ status: 'asc' }, { dueOn: 'asc' }], include: { promoter: true, referral: { select: { id: true, schoolName: true, city: true, invoiceMinor: true } } } });
    return rows.map(({ promoter: { pan, bankAccount, ifsc, upi, payeeName, kycVerifiedAt, payoutDetailsAt, ...p }, ...y }) => ({
      ...y,
      promoter: { ...p, payeeName, ifsc, upi, panMasked: pan ? `${pan.slice(0, 2)}•••••${pan.slice(-2)}` : null, bankAccountMasked: bankAccount ? `••••${bankAccount.slice(-4)}` : null, detailsComplete: !!payoutDetailsAt, kycVerified: !!kycVerifiedAt },
    }));
  }
  async listPayoutsForPromoter(p: Promoter) {
    return this.db.referralPayout.findMany({
      where: { promoterId: p.id }, orderBy: { dueOn: 'desc' },
      select: { id: true, grossMinor: true, tdsMinor: true, netMinor: true, dueOn: true, status: true, utr: true, paidOn: true, createdAt: true, referral: { select: { schoolName: true, city: true } } },
    });
  }

  async markPaid(id: string, dto: MarkPaidDto): Promise<ReferralPayout> {
    const y = await this.db.referralPayout.findUnique({ where: { id }, include: { promoter: true, referral: true } });
    if (!y) throw new NotFoundException('Payout not found');
    if (y.status === 'PAID') throw new ApiError('REFERRAL_BAD_TRANSITION', 'Already marked paid.', 409);
    if (y.referral.status !== 'PAYOUT_DUE') throw new ApiError('REFERRAL_BAD_TRANSITION', `This referral is ${y.referral.status.toLowerCase().replace('_', ' ')}, not waiting for its payout.`, 409);
    if (!y.promoter.payoutDetailsAt) throw new ApiError('PAYOUT_DETAILS_MISSING', `${y.promoter.name} has not added payout details yet.`, 409);
    const paidOn = dto.paidOn ? new Date(dto.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) throw new ApiError('VALIDATION', 'The paid-on date is not a date.', 400, 'paidOn');
    const out = await this.db.referralPayout.update({ where: { id }, data: { status: 'PAID', utr: dto.utr, paidOn } });
    await this.db.referral.update({ where: { id: y.referralId }, data: { status: 'PAID', events: { create: { actor: 'OWNER', fromStatus: y.referral.status, toStatus: 'PAID', body: `Paid, reference ${dto.utr}.` } } } });
    if (y.promoter.email) runInBackground(() => this.mail.paid(y.promoter.email!, y.referral.schoolName, y.netMinor, dto.utr), () => undefined);
    return out;
  }

  async openTaskCount(): Promise<number> {
    return this.db.referralTask.count({ where: { status: 'OPEN' } });
  }
}

const money = (minor: number) => `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** +91 by default; a number that is not a phone becomes null and the DTO has already refused it. */
export function e164(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  if (d.length === 11 && d.startsWith('0')) return `+91${d.slice(1)}`;
  if (d.length >= 8 && d.length <= 15 && raw.trim().startsWith('+')) return `+${d}`;
  return null;
}
