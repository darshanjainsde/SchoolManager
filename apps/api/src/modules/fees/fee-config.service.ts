import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/storage/storage.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import type { SaveBankDetailDto, SaveProviderConfigDto } from './fees.dto';

/**
 * The payment-setup screen's backend: the school's bank details (public, shown
 * to parents) and per-provider gateway configuration (half of it secret).
 *
 * The secret half never leaves this service. `getSetup()` returns which secret
 * keys are PRESENT, never their values — so the admin screen can show
 * "•••• saved" without the API ever being a way to read a credential back out.
 */

const ALGO = 'aes-256-gcm';

@Injectable()
export class FeeConfigService {
  private readonly logger = new Logger(FeeConfigService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  /**
   * Envelope encryption keyed per school, so one school's leaked ciphertext is
   * not a key to another's. Derived from a platform secret plus the schoolId —
   * a full KMS is the right answer at scale and this is the shape that swaps
   * into one, because only these two methods know how a secret is stored.
   */
  private key(schoolId: string): Buffer {
    const master = process.env.FEES_SECRET_KEY;
    if (!master) {
      throw new ApiError(
        'INTERNAL',
        'This deployment has no FEES_SECRET_KEY, so gateway credentials cannot be stored.',
        503,
      );
    }
    return scryptSync(master, `fees:${schoolId}`, 32);
  }

  private encrypt(schoolId: string, plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key(schoolId), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  /** Unused by any read path today — gateway `start()` will call it. */
  decrypt(schoolId: string, blob: string): string {
    const [iv, tag, data] = blob.split('.');
    const decipher = createDecipheriv(ALGO, this.key(schoolId), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /**
   * Everything the payment-setup screen renders, in one call: the provider
   * cards (built from each provider's OWN declared fields, so this method
   * knows nothing about PhonePe), and the bank block.
   */
  async getSetup(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [configs, bank] = await Promise.all([
        tx.schoolPaymentConfig.findMany({ where: { schoolId } }),
        tx.schoolBankDetail.findFirst({ where: { schoolId } }),
      ]);
      const byKey = new Map(configs.map((c) => [c.provider, c]));

      const providers = this.providers.all()
        .filter((p) => p.kind === 'GATEWAY')
        .map((p) => {
          const row = byKey.get(p.key);
          const config = (row?.config as Record<string, string>) ?? {};
          const secrets = (row?.secrets as Record<string, string>) ?? {};
          return {
            key: p.key,
            displayName: p.displayName,
            blurb: p.blurb,
            available: p.isAvailable(),
            enabled: Boolean(row?.enabled),
            status: p.resolveStatus(config, Boolean(row?.enabled)),
            statusNote: row?.statusNote ?? null,
            fields: p.configFields.map((f) => ({
              ...f,
              // Never the value. Only whether one is stored.
              value: f.secret ? null : (config[f.name] ?? ''),
              hasValue: f.secret ? Boolean(secrets[f.name]) : Boolean(config[f.name]),
            })),
          };
        });

      return {
        providers,
        bank: bank
          ? {
              accountName: bank.accountName,
              accountNumber: bank.accountNumber,
              ifsc: bank.ifsc,
              bankName: bank.bankName,
              branch: bank.branch,
              upiId: bank.upiId,
              upiQrUrl: bank.upiQrKey ? await this.storage.presignedGet(bank.upiQrKey) : null,
              instructions: bank.instructions,
              isVisible: bank.isVisible,
            }
          : null,
      };
    });
  }

  async saveBankDetail(schoolId: string, dto: SaveBankDetailDto) {
    return withTenant(schoolId, async (tx) => {
      const data = {
        accountName: dto.accountName.trim(),
        accountNumber: dto.accountNumber.trim(),
        ifsc: dto.ifsc.trim().toUpperCase(),
        bankName: dto.bankName.trim(),
        branch: dto.branch?.trim() || null,
        upiId: dto.upiId?.trim() || null,
        instructions: dto.instructions?.trim() || null,
        isVisible: dto.isVisible,
      };
      const existing = await tx.schoolBankDetail.findFirst({ where: { schoolId } });
      if (existing) return tx.schoolBankDetail.update({ where: { schoolId }, data });
      return tx.schoolBankDetail.create({ data: { schoolId, ...data } });
    });
  }

  async saveUpiQr(schoolId: string, file: { buffer: Buffer; filename: string; contentType: string }) {
    const up = await this.storage.upload(
      `schools/${schoolId}/fees`,
      file.filename,
      file.buffer,
      file.contentType,
    );
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.schoolBankDetail.findFirst({ where: { schoolId } });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'Save your bank details before uploading a QR code.', 404);
      }
      if (existing.upiQrKey) await this.storage.delete(existing.upiQrKey).catch(() => undefined);
      await tx.schoolBankDetail.update({ where: { schoolId }, data: { upiQrKey: up.key } });
      return { url: await this.storage.presignedGet(up.key) };
    });
  }

  /**
   * Save a gateway's configuration.
   *
   * Refuses to enable a provider Sckools has not finished onboarding with —
   * the same fact that renders the parent's Pay Now button disabled, enforced
   * on the write path so the two can never disagree.
   */
  async saveProviderConfig(schoolId: string, dto: SaveProviderConfigDto) {
    const provider = this.providers.get(dto.provider);

    if (dto.enabled && !provider.isAvailable()) {
      throw new ApiError(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        `${provider.displayName} is not available yet — Sckools is still completing onboarding.`,
        409,
      );
    }

    // Only fields the provider actually declares are stored. An unknown key in
    // the request is dropped rather than persisted, so a stale client cannot
    // write junk into the config blob.
    const declared = new Map(provider.configFields.map((f) => [f.name, f]));

    return withTenant(schoolId, async (tx) => {
      const existing = await tx.schoolPaymentConfig.findFirst({
        where: { schoolId, provider: dto.provider },
      });
      const config: Record<string, string> = { ...((existing?.config as Record<string, string>) ?? {}) };
      const secrets: Record<string, string> = { ...((existing?.secrets as Record<string, string>) ?? {}) };

      for (const [name, value] of Object.entries(dto.config ?? {})) {
        const field = declared.get(name);
        if (!field || field.secret) continue;
        config[name] = value.trim();
      }
      for (const [name, value] of Object.entries(dto.secrets ?? {})) {
        const field = declared.get(name);
        if (!field || !field.secret) continue;
        // An empty string means "leave what is saved alone", not "erase it" —
        // the field renders blank once saved, so a save of the rest of the
        // form must not silently wipe a credential the admin cannot re-enter.
        if (value.trim() === '') continue;
        secrets[name] = this.encrypt(schoolId, value.trim());
      }

      for (const f of provider.configFields) {
        if (!f.required || !dto.enabled) continue;
        const present = f.secret ? Boolean(secrets[f.name]) : Boolean(config[f.name]);
        if (!present) {
          throw new ApiError('VALIDATION', `${f.label} is needed before you can switch this on.`, 400, f.name);
        }
      }

      const status = provider.resolveStatus(config, dto.enabled);
      const payload = { enabled: dto.enabled, config, secrets, status };

      if (existing) {
        await tx.schoolPaymentConfig.update({ where: { id: existing.id }, data: payload });
      } else {
        await tx.schoolPaymentConfig.create({ data: { schoolId, provider: dto.provider, ...payload } });
      }
      return { provider: dto.provider, status, enabled: dto.enabled };
    });
  }
}
