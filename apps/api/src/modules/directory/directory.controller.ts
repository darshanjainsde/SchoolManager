import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { DirectoryService } from './directory.service';

@Controller('directory')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  /** Unauthenticated list of LIVE schools for the platform landing page. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  list() {
    return this.directory.listLiveSchools();
  }
}
