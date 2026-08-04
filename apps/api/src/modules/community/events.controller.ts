import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { EventsService } from './events.service';
import { RegistrationsService } from './registrations.service';
import { CreateEventDto, RegisterDto, SetRegistrationStatusDto, UpdateEventDto } from './community.dto';

@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('EVENTS')
@Controller('manage/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly registrations: RegistrationsService,
  ) {}

  @Get() list() { return this.events.list(); }
  @Post() create(@Body() dto: CreateEventDto) { return this.events.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.events.remove(id); }

  /** Who is coming, with the counts the desk leads on. */
  @Get(':id/registrations')
  listRegistrations(@Param('id', ParseUUIDPipe) id: string) {
    return this.registrations.listForEvent(id);
  }

  /**
   * An admin adding somebody by hand — a phone booking, a walk-in. The same
   * service the public route uses, so capacity and the waitlist behave
   * identically no matter which door the person came through.
   */
  @Post(':id/registrations')
  addRegistration(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterDto) {
    return this.registrations.register(id, dto);
  }

  @Patch('registrations/:registrationId')
  setRegistrationStatus(
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() dto: SetRegistrationStatusDto,
  ) {
    return this.registrations.setStatus(registrationId, dto.status);
  }
}
