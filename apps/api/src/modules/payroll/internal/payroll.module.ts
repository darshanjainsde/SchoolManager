import { Module } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { MePayController } from './me-pay.controller';
import { PayMeService } from './pay-me.service';
import { PayGradesService } from './pay-grades.service';
import { PayLeaveService } from './pay-leave.service';
import { PayOverviewService } from './pay-overview.service';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService } from './pay-people.service';
import { PayRunService } from './pay-run.service';
import { PayStatutoryService } from './pay-statutory.service';
import { PayslipDocService } from './payslip-doc.service';
import { PayrollController } from './payroll.controller';
import { SalaryGuard } from './salary.guard';

/**
 * SALARY. Fully encapsulated: siblings import nothing from here but
 * `PayrollModule` through ../index.ts.
 *
 * `FeaturesModule` and `TenancyModule` are imported because members inject
 * from them — a @Global provider elsewhere is not enough, and a module that
 * relies on one fails to boot the moment it is instantiated without the root
 * (the press-di spec exists for exactly that).
 */
@Module({
  imports: [FeaturesModule, TenancyModule],
  controllers: [PayrollController, MePayController],
  providers: [PayslipDocService, 
    SalaryGuard,
    AuditService,
    PayPackService,
    PayPeopleService,
    PayGradesService,
    PayLeaveService,
    PayOverviewService,
    PayRunService,
    PayStatutoryService,
    PayMeService,
  ],
})
export class PayrollModule {}
