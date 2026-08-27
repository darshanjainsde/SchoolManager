import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { BlogPost } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { BlogCmsService } from './blog-cms.service';
import { AddSelectionDto, BlogSettingsDto, CreatePostDto, PatchSelectionDto, UpdatePostDto } from './blog.dto';

/** SchoolJwtGuard reads no role, so without RolesGuard every route here was
 *  reachable with a STUDENT or PARENT token. Every caller is under /app, which
 *  is already SCHOOL_ADMIN-only, so nothing legitimate loses access. */
@Controller('cms/blog')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('BLOG')
@Roles('SCHOOL_ADMIN')
export class BlogCmsController {
  constructor(
    private readonly cms: BlogCmsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('posts')
  listPosts(): Promise<BlogPost[]> {
    return this.cms.list(this.sid());
  }

  @Get('posts/:id')
  getPost(@Param('id', ParseUUIDPipe) id: string): Promise<BlogPost> {
    return this.cms.get(this.sid(), id);
  }

  @Post('posts')
  createPost(@Body() dto: CreatePostDto): Promise<BlogPost> {
    return this.cms.create(this.sid(), dto);
  }

  @Patch('posts/:id')
  updatePost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto): Promise<BlogPost> {
    return this.cms.update(this.sid(), id, dto);
  }

  @Delete('posts/:id')
  deletePost(@Param('id', ParseUUIDPipe) id: string) {
    return this.cms.remove(this.sid(), id);
  }

  @Post('posts/:id/publish')
  publish(@Param('id', ParseUUIDPipe) id: string): Promise<BlogPost> {
    return this.cms.publish(this.sid(), id);
  }

  @Post('posts/:id/submit-global')
  submitGlobal(@Param('id', ParseUUIDPipe) id: string): Promise<BlogPost> {
    return this.cms.submitGlobal(this.sid(), id);
  }

  @Get('library')
  library() {
    return this.cms.library(this.sid());
  }

  @Get('selections')
  listSelections() {
    return this.cms.listSelections(this.sid());
  }

  @Post('selections')
  addSelection(@Body() dto: AddSelectionDto) {
    return this.cms.addSelection(this.sid(), dto.postId);
  }

  @Delete('selections/:postId')
  removeSelection(@Param('postId', ParseUUIDPipe) postId: string) {
    return this.cms.removeSelection(this.sid(), postId);
  }

  @Patch('selections/:postId')
  patchSelection(@Param('postId', ParseUUIDPipe) postId: string, @Body() dto: PatchSelectionDto) {
    return this.cms.patchSelection(this.sid(), postId, dto);
  }

  @Get('settings')
  getSettings() {
    return this.cms.getSettings(this.sid());
  }

  @Patch('settings')
  updateSettings(@Body() dto: BlogSettingsDto) {
    return this.cms.updateSettings(this.sid(), dto);
  }
}
