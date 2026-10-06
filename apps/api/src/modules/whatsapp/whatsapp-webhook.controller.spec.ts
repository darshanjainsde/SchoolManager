import 'reflect-metadata';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

it("Meta's callbacks are never throttled — a morning fan-out sends hundreds a minute", () => {
  expect(Reflect.getMetadata('THROTTLER:SKIPdefault', WhatsAppWebhookController)).toBe(true);
});
