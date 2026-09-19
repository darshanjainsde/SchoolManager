import { Module } from '@nestjs/common';
import { EmailCheckController } from './email-check.controller';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';

/** Email's two doors: Resend's receipts, and the office's "will this address take mail?". */
@Module({
  controllers: [ResendWebhookController, EmailCheckController],
  providers: [ResendWebhookService],
})
export class MailWebhooksModule {}
