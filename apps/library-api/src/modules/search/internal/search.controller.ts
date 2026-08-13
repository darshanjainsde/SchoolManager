import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SuggestQueryDto } from './dto';
import { SuggestService } from './suggest.service';

/**
 * With no scanner in this product, this endpoint is how every transaction at
 * the counter begins, so it is deliberately cheap and deliberately narrow: one
 * read, no writes, and a small page.
 *
 * `MEMBER` is included — a student may search the catalogue from their app, and
 * the service returns only what that role should see. It is gated on `CATALOG`
 * rather than `CIRCULATION` for the same reason: looking a book up is a
 * catalogue act, and a plan without circulation should still be able to search.
 */
@Controller('search')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('CATALOG')
export class SearchController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(SuggestService) private readonly suggest: SuggestService,
  ) {}

  @Get('suggest')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  list(@Query() query: SuggestQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.suggest.suggest(tx, orgId, query, user.branches));
  }
}
