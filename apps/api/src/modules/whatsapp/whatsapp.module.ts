import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { ManagementModule } from '../management';
import { PhoneVerifyController } from './phone-verify.controller';
import { PhoneVerifyService } from './phone-verify.service';
import { WhatsAppActionsService } from './whatsapp-actions.service';
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
  // The settings controller guards with RequireFeatureGuard and reads the
  // tenant: both providers live in these two modules. Leaving them out does
  // not fail the build or a unit test — it fails Nest's boot, and every
  // route 500s. module-wiring.spec.ts now checks this for every module.
  // ManagementModule for LeaveService: a tap on WhatsApp runs the SAME
  // approve / reject / assign the console runs.
  imports: [FeaturesModule, TenancyModule, ManagementModule],
  controllers: [WhatsAppWebhookController, WhatsAppSettingsController, PhoneVerifyController],
  providers: [WhatsAppWebhookService, WhatsAppSettingsService, WhatsAppActionsService, PhoneVerifyService],
})
export class WhatsAppModule {}
