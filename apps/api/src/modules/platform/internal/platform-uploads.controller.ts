import {
  BadRequestException,
  Controller,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { StorageService } from '../../../common/storage/storage.service';

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB — plenty for a logo/favicon
const ALLOWED = /(jpe?g|png|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

@ApiTags('platform-uploads')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/uploads')
export class PlatformUploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('logo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_SIZE })
        .build({ errorHttpStatusCode: 413 }),
    )
    file: Express.Multer.File,
  ) {
    return this.uploadImage('logos', file);
  }

  @Post('favicon')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFavicon(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_SIZE })
        .build({ errorHttpStatusCode: 413 }),
    )
    file: Express.Multer.File,
  ) {
    return this.uploadImage('favicons', file);
  }

  private async uploadImage(prefix: string, file: Express.Multer.File) {
    if (!ALLOWED.test(file.mimetype)) {
      throw new BadRequestException(`Unsupported image type: ${file.mimetype}`);
    }
    return this.storage.upload(prefix, file.originalname, file.buffer, file.mimetype);
  }
}
