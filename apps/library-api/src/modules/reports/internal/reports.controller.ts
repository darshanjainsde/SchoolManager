import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  LateReturnersQueryDto,
  MostReadQueryDto,
  ReadNothingQueryDto,
  ReportWindowDto,
} from './dto';
import { ReportsService } from './reports.service';

/**
 * What the school asks the library.
 *
 * STAFF ONLY, MEMBER denied throughout — including ASSISTANT, which is a
 * narrower line than the desk routes draw. These reports name children by class
 * and by what they have not read, and that is a conversation for whoever runs
 * the school, not for whoever is covering the counter. An assistant needs the
 * desk, the shelf and the not-returned list; none of those are here.
 */
@Controller('reports')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard)
@RequireFeature('CIRCULATION')
@Roles('ORG_OWNER', 'LIBRARIAN')
export class ReportsController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  /**
   * `to` is treated as INCLUSIVE by adding a day, because a user typing
   * `to=2026-08-14` means "up to and including the 14th". A half-open range
   * taken literally silently drops the last day of every term, and the report
   * still looks plausible — which is the worst kind of wrong for a number
   * somebody makes a decision from.
   */
  private window(dto: ReportWindowDto): { from: Date; to: Date } {
    const from = new Date(`${dto.from}T00:00:00.000Z`);
    const to = new Date(`${dto.to}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be real dates');
    }
    if (to < from) throw new BadRequestException('to must not be before from');
    return { from, to: new Date(to.getTime() + 86_400_000) };
  }

  @Get('issues-per-class')
  issuesPerClass(@Query() q: ReportWindowDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const { from, to } = this.window(q);
    return withOrg(orgId, (tx) => this.reports.issuesPerClass(tx, orgId, from, to, user.branches));
  }

  @Get('most-read')
  mostRead(@Query() q: MostReadQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const { from, to } = this.window(q);
    return withOrg(orgId, (tx) =>
      this.reports.mostRead(tx, orgId, from, to, user.branches, q.limit ?? 20),
    );
  }

  /** The one a principal actually asks for. See the service doc. */
  @Get('read-nothing')
  readNothing(@Query() q: ReadNothingQueryDto) {
    const orgId = this.orgs.requireOrgId();
    const { from, to } = this.window(q);
    return withOrg(orgId, (tx) => this.reports.readNothing(tx, orgId, from, to, q.classRef ?? null));
  }

  @Get('late-returners')
  lateReturners(@Query() q: LateReturnersQueryDto) {
    const orgId = this.orgs.requireOrgId();
    const { from, to } = this.window(q);
    return withOrg(orgId, (tx) =>
      this.reports.chronicLateReturners(tx, orgId, from, to, q.minLate ?? 3),
    );
  }
}
