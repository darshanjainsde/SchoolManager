import {
  BadRequestException,
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
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CopiesService } from './copies.service';
import { parseCsvRecords } from './csv-parse';
import {
  AddCopyDto,
  CreateCategoryDto,
  CreateTitleDto,
  SearchTitlesQueryDto,
  UpdateCopyDto,
  UpdateTitleDto,
} from './dto';
import { ImportService } from './import.service';
import { IsbnLookupService } from './isbn-lookup.service';
import { MulterExceptionFilter } from './multer-exception.filter';
import { SearchService } from './search.service';
import { TitlesService } from './titles.service';

/** 10 MiB is generous for a text CSV within the 2,000-row cap; this only guards against an absurd upload before it's even parsed. */
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

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
    @Inject(ImportService) private readonly importService: ImportService,
    @Inject(IsbnLookupService) private readonly isbnLookup: IsbnLookupService,
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

  /**
   * `memoryStorage()` rather than the default disk storage: the file only
   * needs to become a UTF-8 string for `parseCsvRecords`, and a serverless
   * function's tmp filesystem is not somewhere this handler wants to manage
   * cleanup for. `?dryRun=true` is read as a raw query string (not a
   * class-validator DTO with `@Type(() => Boolean)`) on purpose —
   * class-transformer's `Boolean('false')` is `true` (any non-empty string
   * is truthy), which is exactly the footgun a dry-run flag cannot afford.
   */
  @Post('import/titles')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  importTitles(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('CSV file is required (multipart field "file")');
    const orgId = this.orgs.requireOrgId();
    const { records } = parseCsvRecords(file.buffer.toString('utf8'));
    return this.importService.importTitles(orgId, records, { dryRun: dryRun === 'true' });
  }

  @Get('isbn/:isbn')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  lookupIsbn(@Param('isbn') isbn: string) {
    return this.isbnLookup.lookup(isbn);
  }
}
