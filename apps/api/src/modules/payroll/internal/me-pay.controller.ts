import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { AuditService } from '../../../common/audit/audit.service';
import { PayMeService } from './pay-me.service';
import { PayPeopleService } from './pay-people.service';
import { PayStatutoryService } from './pay-statutory.service';
import { PayDetailsDto, SaveDeclarationDto } from './payroll.dto';

/**
 * MY PAY — every employee's own half, teacher and non-teaching staff alike.
 *
 * No SalaryGuard here, on purpose: this route answers only about the caller,
 * resolved from their own user id, and it can never be pointed at anybody
 * else. A driver and a principal use the same endpoint and each sees one
 * person's payslips.
 */
@Controller('me/pay')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('SALARY')
@Roles('TEACHER', 'STAFF', 'SCHOOL_ADMIN')
export class MePayController {
  constructor(
    private readonly me: PayMeService,
    private readonly people: PayPeopleService,
    private readonly statutory: PayStatutoryService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  mine(@CurrentUser() u: SchoolJwtPayload) { return this.me.mine(this.sid(), u.sub); }

  @Get('payslips/:id')
  payslip(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.me.payslip(this.sid(), u.sub, id);
  }

  /**
   * My own bank and tax numbers.
   *
   * Same rows the admin writes, so the office sees a change the moment it is
   * saved — there is no copy of this anywhere. Resolved from the caller's own
   * user id like every other route here, so it can never be pointed at
   * anybody else.
   */
  @Get('details')
  async details(@CurrentUser() u: SchoolJwtPayload) {
    const who = await this.me.identify(this.sid(), u.sub);
    return this.people.details(this.sid(), who.kind, who.id);
  }

  @Post('details')
  async saveDetails(@CurrentUser() u: SchoolJwtPayload, @Body() dto: PayDetailsDto) {
    const who = await this.me.identify(this.sid(), u.sub);
    const r = await this.people.setDetails(this.sid(), who.kind, who.id, dto);
    await this.audit.record({
      schoolId: this.sid(), actorUserId: u.sub, action: 'salary.details.self', entity: 'EmployeePay',
      meta: { personKind: who.kind, personId: who.id, fields: Object.keys(dto) },
    });
    return r;
  }

  @Post('declaration')
  declare(@CurrentUser() u: SchoolJwtPayload, @Body() dto: SaveDeclarationDto) {
    return this.me.saveDeclaration(this.sid(), u.sub, dto);
  }

  /** My own year, for the annual certificate the school files from. */
  @Get('statement')
  async statement(@CurrentUser() u: SchoolJwtPayload, @Query('taxYear') taxYear: string) {
    const who = await this.me.identify(this.sid(), u.sub);
    return this.statutory.annualStatement(this.sid(), who.kind, who.id, Number(taxYear));
  }
}
