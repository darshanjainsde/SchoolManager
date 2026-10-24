import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { MarketingModule } from '../marketing';
import { OwnerModule } from '../owner';
import { TenancyModule } from '../tenancy';
import { OwnerSupportController, SchoolSupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * The support desk. Its own module: the school door is an office route and
 * the owner door is a platform route, and neither belongs inside management
 * or the owner console's own module. MailModule is global; MarketingModule
 * lends the owner's contact address; OwnerModule lends the consent-gated
 * impersonation link.
 */
@Module({
  imports: [TenancyModule, StorageModule, MarketingModule, OwnerModule],
  controllers: [SchoolSupportController, OwnerSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
