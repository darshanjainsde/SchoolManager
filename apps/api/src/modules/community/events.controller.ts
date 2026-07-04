import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './community.dto';

@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('EVENTS')
@Controller('manage/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get() list() { return this.events.list(); }
  @Post() create(@Body() dto: CreateEventDto) { return this.events.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.events.remove(id); }
}
