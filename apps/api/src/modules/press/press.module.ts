import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { CertificateService } from './certificate.service';
import { PressController } from './press.controller';
import { PressPortalController } from './press-portal.controller';
import { PressRegisterService } from './press-register.service';
import { ReportCardService } from './report-card.service';

/**
 * The Press — printed documents with a register.
 *
 * To add a document type later (ID cards, the NEP holistic card, consent
 * forms): add the value to `PRESS_DOC_TYPES` in @skoolos/types, give it a
 * sheet template on the web, and write its issuing path here. The register,
 * the serial allocator and the reprint flow already handle any type — that is
 * the point of `type` being TEXT.
 */
@Module({
  imports: [AuthModule, FeaturesModule, TenancyModule],
  controllers: [PressController, PressPortalController],
  providers: [ReportCardService, CertificateService, PressRegisterService],
})
export class PressModule {}
