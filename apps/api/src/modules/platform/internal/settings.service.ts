import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Encrypted key-value store for owner-portal configurable secrets:
 *   - stripe.secretKey, stripe.webhookSecret, stripe.publishableKey
 *   - resend.apiKey, resend.fromEmail
 *   - ably.apiKey  (optional — SSE works without it)
 *   - otel.endpoint, otel.headers
 *
 * Encryption: AES-256-GCM. The 32-byte key is derived from PLATFORM_SETTINGS_KEY
 * (env). When the env var is missing or short, we fall back to a SHA-256 of
 * the platform JWT secret + a fixed pepper — so a fresh checkout still works
 * locally without manual setup; production MUST set the env var.
 *
 * Values are stored as base64(iv || ciphertext || tag). 12-byte IV, 16-byte tag.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, { value: string; loadedAt: number }>();
  private readonly CACHE_TTL_MS = 30_000;

  private getKey(): Buffer {
    const fromEnv = process.env.PLATFORM_SETTINGS_KEY;
    if (fromEnv && fromEnv.length >= 32) {
      // 32-byte hex (64 chars) or longer string. Take the first 32 bytes via sha256.
      return createHash('sha256').update(fromEnv).digest();
    }
    const seed = (process.env.JWT_PLATFORM_ACCESS_SECRET ?? 'skoolos-platform-fallback') + ':settings-pepper-v1';
    return createHash('sha256').update(seed).digest();
  }

  async set(key: string, plain: string, updatedById?: string, scope = 'global'): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const valueCipher = Buffer.concat([iv, ct, tag]).toString('base64');

    await getPlatformPrisma().platformSetting.upsert({
      where: { key },
      create: { key, valueCipher, scope, updatedById },
      update: { valueCipher, scope, updatedById },
    });
    this.cache.delete(key);
  }

  async get(key: string): Promise<string | undefined> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.loadedAt < this.CACHE_TTL_MS) return cached.value;

    const row = await getPlatformPrisma().platformSetting.findUnique({ where: { key } });
    if (!row) return undefined;
    try {
      const buf = Buffer.from(row.valueCipher, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(buf.length - 16);
      const ct = buf.subarray(12, buf.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', this.getKey(), iv);
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      this.cache.set(key, { value, loadedAt: Date.now() });
      return value;
    } catch (e) {
      this.logger.error(`Failed to decrypt setting ${key}: ${(e as Error).message}`);
      return undefined;
    }
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    const raw = await this.get(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    await getPlatformPrisma().platformSetting.delete({ where: { key } }).catch(() => undefined);
    this.cache.delete(key);
  }

  /** List existing keys (NOT the values). Owner portal uses this to show which secrets are configured. */
  async listKeys(): Promise<Array<{ key: string; scope: string; updatedAt: Date }>> {
    return getPlatformPrisma().platformSetting.findMany({
      select: { key: true, scope: true, updatedAt: true },
      orderBy: { key: 'asc' },
    });
  }
}
