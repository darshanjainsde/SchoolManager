import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { WhatsAppWebhookService, type WebhookBody } from './whatsapp-webhook.service';

/**
 * `@Public()`: Meta carries no user JWT. Authentication is the HMAC
 * signature over the raw body (main.ts keeps `rawBody`), checked before a
 * single row is read. Meta retries a non-2xx for hours, so an unsigned or
 * malformed post is refused with 403 — never accepted and ignored.
 *
 * `@SkipThrottle()`: Meta posts every status of every message we send. A
 * morning fan-out is hundreds a minute from a handful of IPs; our 100/min/IP
 * limit answered 429 and Meta backs off for hours. The HMAC check is the gate
 * here, not the rate.
 */
@Controller('webhooks/whatsapp')
@Public()
@SkipThrottle()
export class WhatsAppWebhookController {
  constructor(private readonly svc: WhatsAppWebhookService) {}

  @Get()
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    const echo = this.svc.verifyChallenge(mode, token, challenge);
    if (echo === null) throw new ForbiddenException('Webhook verification failed.');
    return echo;
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') sig: string | undefined, @Body() body: WebhookBody) {
    if (!this.svc.signatureValid(req.rawBody, sig)) throw new ForbiddenException('Bad signature.');
    return this.svc.handle(body);
  }
}
