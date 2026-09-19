import { Body, Controller, ForbiddenException, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { ResendWebhookService, type ResendEvent } from './resend-webhook.service';

/** `@Public()`: Resend carries no user JWT; the Svix signature over the raw body is the credential. */
@Controller('webhooks/resend')
@Public()
export class ResendWebhookController {
  constructor(private readonly svc: ResendWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
    @Body() body: ResendEvent,
  ) {
    if (!this.svc.signatureValid(req.rawBody, { id, timestamp, signature })) throw new ForbiddenException('Bad signature.');
    return this.svc.handle(body);
  }
}
