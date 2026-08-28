import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { EventsService } from './events.service';
import { RegistrationsService } from './registrations.service';
import { CreateEventDto, RegisterDto, SetRegistrationStatusDto, UpdateEventDto } from './community.dto';

/** SchoolJwtGuard reads no role, so without RolesGuard every route here was
 *  reachable with a STUDENT or PARENT token. Every caller is under /app, which
 *  is already SCHOOL_ADMIN-only, so nothing legitimate loses access. */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('EVENTS')
@Roles('SCHOOL_ADMIN')
@Controller('manage/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly registrations: RegistrationsService,
  ) {}

  @Get() list() { return this.events.list(); }

  /** Schools this event can be addressed to — powers the audience picker's search. */
  @Get('audience-candidates')
  audienceCandidates(@Query('q') q?: string) {
    return this.events.audienceCandidates(q);
  }
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
