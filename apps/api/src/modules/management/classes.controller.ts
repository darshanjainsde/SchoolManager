import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { ClassesService } from './classes.service';
import { CreateClassDto, UpdateClassDto } from './management.dto';

@Controller('manage/classes')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class ClassesController {
  constructor(
    private readonly classes: ClassesService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // Teachers read the class list to pick a section on the attendance and
  // tests screens. Every mutation stays admin-only.
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get()
  list() {
    return this.classes.list(this.sid());
  }

  @Post()
  create(@Body() dto: CreateClassDto) {
    return this.classes.create(this.sid(), dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.classes.update(this.sid(), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.classes.remove(this.sid(), id);
  }
}
