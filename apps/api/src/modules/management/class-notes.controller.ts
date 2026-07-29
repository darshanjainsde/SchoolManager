import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { ClassNotesService } from './class-notes.service';
import { CreateClassNoteDto, CreateClassTodoDto, UpdateClassTodoDto } from './management.dto';

@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class ClassNotesController {
  constructor(
    private readonly svc: ClassNotesService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('class-notes')
  list(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date: string,
  ) {
    return this.svc.list(this.sid(), classSectionId, date);
  }

  @Post('class-notes')
  addNote(@Body() dto: CreateClassNoteDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.addNote(this.sid(), u.sub, dto);
  }

  @Delete('class-notes/:id')
  @HttpCode(204)
  removeNote(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.removeNote(this.sid(), u.sub, id);
  }

  @Post('class-todos')
  addTodo(@Body() dto: CreateClassTodoDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.addTodo(this.sid(), u.sub, dto);
  }

  @Patch('class-todos/:id')
  setDone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassTodoDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.setTodoDone(this.sid(), u.sub, id, dto.done);
  }

  @Delete('class-todos/:id')
  @HttpCode(204)
  removeTodo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.removeTodo(this.sid(), u.sub, id);
  }
}
