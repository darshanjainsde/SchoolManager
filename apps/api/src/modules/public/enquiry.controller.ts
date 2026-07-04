import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { EnquiryService } from './enquiry.service';
import { SubmitEnquiryDto } from './public.dto';

@Controller('public')
export class EnquiryController {
  constructor(private readonly enquiry: EnquiryService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('enquiry')
  @HttpCode(201)
  submit(@Body() dto: SubmitEnquiryDto) {
    return this.enquiry.submit(dto);
  }
}
