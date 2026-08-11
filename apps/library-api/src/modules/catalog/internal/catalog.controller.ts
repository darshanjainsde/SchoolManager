import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CopiesService } from './copies.service';
import {
  AddCopyDto,
  CreateCategoryDto,
  CreateTitleDto,
  SearchTitlesQueryDto,
  UpdateCopyDto,
  UpdateTitleDto,
} from './dto';
import { SearchService } from './search.service';
import { TitlesService } from './titles.service';

/**
 * Guard order mirrors the chain documented on LibJwtGuard/RolesGuard/
 * BranchScopeGuard: JWT identity first, then the plan-capability gate, then
 * role, then branch. `@RequireFeature('CATALOG')` is class-level (every
 * route here needs it); `@Roles(...)` is per-handler because read vs write
 * access differs by role (ASSISTANT read-only, LIBRARIAN/ORG_OWNER write,
 * MEMBER search + title detail only — see test/endpoints.ts for the exact
 * matrix this is proven against).
 *
 * BranchScopeGuard only enforces branch scope for a `branchId` the request
 * carries directly (a param, a query string, or — since `AddCopyDto` puts it
 * there — the body of `POST /catalog/titles/:id/copies`). Two routes act on
 * an existing Copy whose branch is a property of that row, not of the
 * request, so the guard cannot see it: `PATCH /catalog/copies/:id` and
 * `GET /catalog/copies/by-barcode/:barcode` enforce branch scope themselves,
 * in CopiesService, after loading the row.
 */
@Controller('catalog')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard)
@RequireFeature('CATALOG')
export class CatalogController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(TitlesService) private readonly titles: TitlesService,
    @Inject(CopiesService) private readonly copies: CopiesService,
    @Inject(CategoriesService) private readonly categories: CategoriesService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  @Get('titles')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  listTitles(@Query() query: SearchTitlesQueryDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.search.searchTitles(tx, orgId, query.q ?? '', query.limit));
  }

  @Post('titles')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  createTitle(@Body() dto: CreateTitleDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.titles.create(tx, orgId, dto));
  }

  @Get('titles/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  getTitle(@Param('id', new ParseUUIDPipe()) id: string) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.titles.get(tx, id));
  }

  @Patch('titles/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  updateTitle(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTitleDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.titles.update(tx, id, dto));
  }

  @Delete('titles/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  async deleteTitle(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ ok: true }> {
    const orgId = this.orgs.requireOrgId();
    await withOrg(orgId, (tx) => this.titles.remove(tx, id));
    return { ok: true };
  }

  @Post('titles/:id/copies')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  addCopy(@Param('id', new ParseUUIDPipe()) titleId: string, @Body() dto: AddCopyDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.copies.add(tx, orgId, titleId, dto));
  }

  @Patch('copies/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  updateCopy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCopyDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.copies.update(tx, id, dto, user.branches));
  }

  @Get('copies/by-barcode/:barcode')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  getCopyByBarcode(@Param('barcode') barcode: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.copies.getByBarcode(tx, orgId, barcode, user.branches));
  }

  @Get('categories')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listCategories() {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.categories.list(tx));
  }

  @Post('categories')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  createCategory(@Body() dto: CreateCategoryDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.categories.create(tx, orgId, dto));
  }
}
