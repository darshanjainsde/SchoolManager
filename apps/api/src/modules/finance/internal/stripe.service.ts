import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { SettingsService } from '../../platform';

/**
 * Thin wrapper around the Stripe SDK that lazily loads keys from
 * SettingsService. If keys aren't set, every call throws 503 — owner needs
 * to configure Stripe via the /platform/settings page first.
 *
 * Why lazy: keys come from the DB, not env, so the SDK isn't initialised at
 * boot (which would force an env-only setup). On miss we cache a `null`
 * marker briefly so we don't hammer the DB on every request.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private cachedKey?: string;
  private cachedAt = 0;
  private cachedClient?: Stripe;
  private readonly TTL_MS = 60_000;

  constructor(private readonly settings: SettingsService) {}

  async client(): Promise<Stripe> {
    const now = Date.now();
    if (this.cachedClient && now - this.cachedAt < this.TTL_MS) {
      return this.cachedClient;
    }
    const key = await this.settings.get('stripe.secretKey');
    if (!key) {
      throw new ServiceUnavailableException('Stripe is not configured. Set stripe.secretKey in /platform/settings.');
    }
    if (key === this.cachedKey && this.cachedClient) {
      this.cachedAt = now;
      return this.cachedClient;
    }
    this.cachedKey = key;
    this.cachedClient = new Stripe(key, { apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion });
    this.cachedAt = now;
    return this.cachedClient;
  }

  async webhookSecret(): Promise<string> {
    const v = await this.settings.get('stripe.webhookSecret');
    if (!v) throw new ServiceUnavailableException('Stripe webhook secret not configured.');
    return v;
  }

  async constructEvent(body: Buffer, signature: string): Promise<Stripe.Event> {
    const stripe = await this.client();
    const secret = await this.webhookSecret();
    return stripe.webhooks.constructEvent(body, signature, secret);
  }
}
