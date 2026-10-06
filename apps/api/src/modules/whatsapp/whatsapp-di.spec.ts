import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CommonAuthModule } from '../../common/auth/auth.module';
import { MailModule } from '../../common/mail/mail.module';
import { StorageModule } from '../../common/storage/storage.module';
import { AuditModule } from '../../common/audit/audit.module';
import { EventBusModule } from '../../common/event-bus/event-bus.module';
import { RedisModule } from '../../common/redis/redis.module';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { NotificationModule } from '../../common/notifications/notification.module';
import { PhoneProfilesService } from '../auth';
import { WhatsAppModule } from './whatsapp.module';
import { InboundIdentityService } from './inbound-identity.service';

/**
 * Bootstrap guard, same shape as `press-di.spec.ts`: WhatsAppModule now
 * imports AuthModule for PhoneProfilesService. A missing export or a cycle
 * would only show at Nest boot (every route 500s), never in a unit test that
 * builds the service with `new` — so compile the real module graph here.
 */
describe('WhatsAppModule DI', () => {
  it('resolves InboundIdentityService with the real PhoneProfilesService from AuthModule', async () => {
    // The @Global() modules the real AppModule mounts at the root.
    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule, MetricsModule, EventBusModule, CommonAuthModule, MailModule, StorageModule, AuditModule, NotificationModule, WhatsAppModule],
    }).compile();

    const svc = moduleRef.get(InboundIdentityService) as unknown as { profiles: unknown };
    expect(svc).toBeInstanceOf(InboundIdentityService);
    expect(svc.profiles).toBeInstanceOf(PhoneProfilesService);

    await moduleRef.close();
  });
});
