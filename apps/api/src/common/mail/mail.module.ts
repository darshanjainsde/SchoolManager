import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailIdentityService } from './mail-identity.service';
import { MailDomainCheck } from './mail-domain';

@Global()
@Module({
  providers: [
    MailService,
    MailIdentityService,
    // A factory, not a class provider: its constructor takes a DNS resolver
    // and a clock (so the spec runs offline), which the injector cannot supply.
    { provide: MailDomainCheck, useFactory: () => new MailDomainCheck() },
  ],
  // MailIdentityService is exported so the admin console can resolve a
  // school's letterhead for the settings preview and invalidate its cache
  // the moment those settings change.
  exports: [MailService, MailIdentityService],
})
export class MailModule {}
