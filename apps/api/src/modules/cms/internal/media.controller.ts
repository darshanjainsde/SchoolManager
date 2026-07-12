import {
  BadRequestException,
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
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { MediaService } from './media.service';
import { ListMediaDto } from './cms.dto';

const KINDS = ['LOGO', 'FAVICON', 'HERO', 'GALLERY', 'STAFF', 'PRINCIPAL', 'COURSE', 'HOF', 'ABOUT', 'EVENT'];

@Controller('site/media')
@UseGuards(SchoolJwtGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Query('kind') kind: string) {
    if (!file) throw new BadRequestException('file required');
    if (!KINDS.includes(kind)) throw new BadRequestException('invalid kind');
    if (!/^image\//.test(file.mimetype)) throw new BadRequestException('only images allowed');
    return this.media.upload(this.sid(), kind as any, file);
  }

  @Get()
  list(@Query() q: ListMediaDto) {
    return this.media.list(this.sid(), q.kind as any);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(this.sid(), id);
  }
}
