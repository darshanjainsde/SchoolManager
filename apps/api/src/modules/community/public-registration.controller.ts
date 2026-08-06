import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { RegistrationsService } from './registrations.service';
import { PublicRegisterDto } from './community.dto';

/**
 * The way in from a school's own website.
 *
 * Everything the registration engine could do was behind an admin login, so a
 * school could publish an open day and nobody could sign up for it. The tenant
 * comes from the request host (the same middleware every public route uses),
 * never from the body.
 *
 * Throttled to 5 a minute per IP — the same budget as the enquiry form. A
 * public POST that writes a row is exactly what a bored script finds first, and
 * an event with three hundred fake families on the list is as useless to the
 * school as an empty one.
 */
@UseGuards(RequireFeatureGuard)
@RequireFeature('EVENTS')
@Controller('public/events')
export class PublicRegistrationController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/register')
  @HttpCode(201)
  register(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicRegisterDto) {
    return this.registrations.registerPublicly(id, dto);
  }
}
