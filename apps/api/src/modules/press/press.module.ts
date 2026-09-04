import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { CertificateService } from './certificate.service';
import { OperatorOrdersController } from './operator-orders.controller';
import { OperatorOrdersService } from './operator-orders.service';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { PressController } from './press.controller';
import { PressOrdersController } from './press-orders.controller';
import { PressOrdersService } from './press-orders.service';
import { PressOverviewService } from './press-overview.service';
import { ResultRoomService } from './result-room.service';
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
  imports: [JwtModule.register({}), AuthModule, FeaturesModule, TenancyModule],
  controllers: [PressController, PressOrdersController, OperatorOrdersController, PressPortalController],
  providers: [ReportCardService, CertificateService, PressRegisterService, PressOrdersService, PressOverviewService, ResultRoomService, OperatorOrdersService, OwnerHostGuard],
  exports: [ReportCardService],
})
export class PressModule {}
