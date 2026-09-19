import { Module } from '@nestjs/common';
import { WhatsAppSettingsController } from './whatsapp-settings.controller';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

/**
 * The WhatsApp channel's two doors: Meta's webhook (receipts and replies)
 * and the school's settings page. The channel itself lives in
 * NotificationModule (global) so every notify() and the outbox reach it.
 */
@Module({
  controllers: [WhatsAppWebhookController, WhatsAppSettingsController],
  providers: [WhatsAppWebhookService, WhatsAppSettingsService],
})
export class WhatsAppModule {}
