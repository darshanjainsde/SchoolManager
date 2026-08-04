import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PhotoService, MAX_AVATAR_BYTES } from './photo.service';

/**
 * `POST /me/photo` — set YOUR OWN profile photo (Phase 5·0d). Role-agnostic
 * across the three person-bearing roles; the service resolves the person row
 * from the JWT, so no id is ever accepted. Multipart field name `file`,
 * image/* only, 2MB cap (both here at the interceptor and re-checked in the
 * service, mirroring `AssignmentsController`'s upload).
 */
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT', 'TEACHER', 'STAFF')
@Controller('me/photo')
export class PhotoController {
  constructor(private readonly photo: PhotoService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES } }))
  upload(
    @CurrentUser() u: SchoolJwtPayload,
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string } | undefined,
  ) {
    return this.photo.setOwn(u.sub, u.role, file);
  }
}
