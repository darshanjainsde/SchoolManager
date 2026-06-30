import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { CreateClassDto, UpdateClassDto, CreateSectionDto, UpdateSectionDto } from './academics.dto';
import { throwOnUnique, throwOnNotFound } from './grades.controller';

@ApiTags('academics-classes')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('classes')
export class ClassesController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async list(@Query('academicYearId') academicYearId?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.class.findMany({
        where: academicYearId ? { academicYearId } : undefined,
        include: { grade: true, sections: true, academicYear: true },
        orderBy: [{ grade: { sequence: 'asc' } }, { name: 'asc' }],
      }),
    );
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async one(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) =>
      tx.class.findUnique({
        where: { id },
        include: { grade: true, sections: true, academicYear: true, enrollments: { include: { section: true } } },
      }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  async create(@Body() dto: CreateClassDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    // Validate FKs exist within this tenant.
    await withTenant(schoolId, async (tx) => {
      const g = await tx.grade.findUnique({ where: { id: dto.gradeId } });
      if (!g) throw new BadRequestException('gradeId not in this school');
      const y = await tx.academicYear.findUnique({ where: { id: dto.academicYearId } });
      if (!y) throw new BadRequestException('academicYearId not in this school');
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.class.create({
          data: {
            schoolId,
            gradeId: dto.gradeId,
            academicYearId: dto.academicYearId,
            name: dto.name,
            classTeacherUserId: dto.classTeacherUserId,
          },
        }),
      );
    } catch (e) {
      throwOnUnique(e);
    }
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateClassDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) => tx.class.update({ where: { id }, data: dto }));
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
      await withTenant(schoolId, (tx) => tx.class.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throwOnNotFound(e);
    }
  }
}

@ApiTags('academics-sections')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('sections')
export class SectionsController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async list(@Query('classId') classId?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.section.findMany({ where: classId ? { classId } : undefined, orderBy: { name: 'asc' } }),
    );
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  async create(@Body() dto: CreateSectionDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    await withTenant(schoolId, async (tx) => {
      const cls = await tx.class.findUnique({ where: { id: dto.classId } });
      if (!cls) throw new BadRequestException('classId not in this school');
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.section.create({
          data: { schoolId, classId: dto.classId, name: dto.name, capacity: dto.capacity ?? 40 },
        }),
      );
    } catch (e) {
      throwOnUnique(e);
    }
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateSectionDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) => tx.section.update({ where: { id }, data: dto }));
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
      await withTenant(schoolId, (tx) => tx.section.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throwOnNotFound(e);
    }
  }
}
