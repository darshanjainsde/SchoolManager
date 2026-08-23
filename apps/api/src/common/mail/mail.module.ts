import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailIdentityService } from './mail-identity.service';

@Global()
@Module({
  providers: [MailService, MailIdentityService],
  // MailIdentityService is exported so the admin console can resolve a
  // school's letterhead for the settings preview and invalidate its cache
  // the moment those settings change.
  exports: [MailService, MailIdentityService],
})
export class MailModule {}
