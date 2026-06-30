import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { CreateSubjectDto, UpdateSubjectDto } from './academics.dto';
import { throwOnUnique, throwOnNotFound } from './grades.controller';

@ApiTags('academics-subjects')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async list() {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) => tx.subject.findMany({ orderBy: { code: 'asc' } }));
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async one(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) => tx.subject.findUnique({ where: { id } }));
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  async create(@Body() dto: CreateSubjectDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.subject.create({
          data: { schoolId, code: dto.code.toUpperCase(), name: dto.name, isElective: dto.isElective ?? false },
        }),
      );
    } catch (e) {
      throwOnUnique(e);
    }
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) => tx.subject.update({ where: { id }, data: dto }));
    } catch (e) {
      throwOnNotFound(e);
      throwOnUnique(e);
    }
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async remove(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      await withTenant(schoolId, (tx) => tx.subject.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throwOnNotFound(e);
    }
  }
}
