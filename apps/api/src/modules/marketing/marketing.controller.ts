import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { MarketingService } from './marketing.service';
import { CreateLeadDto } from './marketing.dto';

/** Public endpoints backing the sckools.com marketing site. */
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Public()
  @Get('config')
  config() {
    return this.marketing.getPublicConfig();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  @HttpCode(201)
  createLead(@Body() dto: CreateLeadDto) {
    return this.marketing.createLead(dto);
  }
}
