import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { AssignmentsService, MAX_ATTACHMENT_BYTES } from './assignments.service';
import { CreateAssignmentDto } from './management.dto';

/**
 * Assignments (T21). File attachments upload through THIS module's own
 * `POST /manage/assignments/upload`, deliberately NOT `POST /site/media`
 * (`MediaController`, `apps/api/src/modules/cms/internal/media.controller.ts`):
 *
 *  - `MediaService`/`MediaAsset` are scoped to a fixed site-content `kind`
 *    enum (LOGO/FAVICON/HERO/GALLERY/STAFF/…) — an assignment attachment has
 *    no honest fit in that taxonomy.
 *  - `MediaController.upload` rejects anything that isn't `image/*` — a
 *    teacher attaching a scanned worksheet as a PDF would 400 unconditionally.
 *  - `MediaController` carries NO `@Roles` guard at all (only
 *    `SchoolJwtGuard`) — any authenticated school login, any role, may call
 *    it today. An assignments upload needs a TEACHER-usable path with the
 *    SAME ownership story as the rest of this module.
 *
 * So: a THIN endpoint here that delegates to the SAME underlying
 * `StorageService` (S3/MinIO locally, Supabase Storage in prod) `MediaService`
 * itself wraps — no new storage machinery, just a different, correctly-scoped
 * front door onto it. See `AssignmentsService.upload`.
 *
 * Vercel serverless functions cap a request body at roughly 4.5MB —
 * `MAX_ATTACHMENT_BYTES` (4MB) stays under that with headroom for multipart
 * framing. The web/mobile UI enforces the SAME cap client-side (so an
 * oversized file is rejected before ever leaving the device), and this
 * multer limit plus `AssignmentsService.upload`'s own check enforce it again
 * server-side — never trust the client alone.
 */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
@Controller('manage/assignments')
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    return this.assignments.upload(this.sid(), file);
  }

  // TEACHER may create too — restricted to their own class sections
  // (AssignmentsService.create enforces this via
  // AttendanceService.myClassSections, mirroring ExamsController).
  @Post()
  create(@Body() dto: CreateAssignmentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.assignments.create(this.sid(), u.sub, u.role, dto);
  }

  @Get()
  list(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.assignments.list(this.sid(), classSectionId, u.sub, u.role);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.assignments.remove(this.sid(), id, u.sub, u.role);
  }
}
