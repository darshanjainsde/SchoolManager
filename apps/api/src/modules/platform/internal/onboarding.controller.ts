import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { OnboardingService } from './onboarding.service';
import { OnboardSchoolDto } from './onboarding.dto';

@ApiTags('platform-onboarding')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/schools')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** "Fill one form → provisioned tenant". */
  @Post()
  async create(@Body() dto: OnboardSchoolDto) {
    return this.onboarding.onboard(dto);
  }
}
