import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RegisterService } from './register.service';
import { RegisterQueryDto, StockTakeDto, WeedCopyDto } from './dto';

/**
 * The accession register, the annual stock take, and weeding.
 *
 * Gated on CATALOG rather than CIRCULATION: the register is a property of the
 * stock, and a plan without lending still has books to account for.
 *
 * MEMBER is denied throughout. The register carries what the school paid for
 * every book, per copy — an auditor's document, not a reader's.
 */
@Controller('register')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('CATALOG')
export class RegisterController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(RegisterService) private readonly register: RegisterService,
  ) {}

  /** The fourteen columns, in accession order. */
  @Get()
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  list(@Query() query: RegisterQueryDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) =>
      this.register.list(tx, orgId, {
        limit: query.limit ?? 200,
        offset: query.offset ?? 0,
        branchId: query.branchId,
      }),
    );
  }

  /**
   * Reconcile what is on the shelf against what the register says.
   *
   * A POST because the input is a morning's worth of typing, not a query
   * string — but it writes nothing. The stock take is deliberately stateless.
   */
  @Post('stock-take')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  stockTake(@Body() dto: StockTakeDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.register.stockTake(tx, orgId, dto.found, dto.branchId));
  }

  /** What the register says should be on the shelf but was not typed. */
  @Post('stock-take/unaccounted')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  unaccounted(@Body() dto: StockTakeDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.register.unaccountedFor(tx, orgId, dto.found, dto.branchId));
  }

  /**
   * Take a book out of stock on purpose. WRITERS: removing a book nobody has
   * complained about is not desk work.
   */
  @Post('weed/:copyId')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  weed(
    @Param('copyId', new ParseUUIDPipe()) copyId: string,
    @Body() dto: WeedCopyDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) =>
      this.register.weed(tx, orgId, copyId, dto.reason, dto.approvedByNote, user.sub, new Date()),
    );
  }
}
