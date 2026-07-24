import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { BlogPost } from '@skoolos/db';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { BlogOwnerService } from './blog-owner.service';
import { RejectPostDto } from './blog.dto';

@Controller('owner/blog')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class BlogOwnerController {
  constructor(private readonly owner: BlogOwnerService) {}

  @Get('pending')
  pending() {
    return this.owner.listPending();
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<BlogPost> {
    return this.owner.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPostDto): Promise<BlogPost> {
    return this.owner.reject(id, dto.reason);
  }
}
