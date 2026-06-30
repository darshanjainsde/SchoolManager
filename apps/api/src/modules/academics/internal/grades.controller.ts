import {
  Body,
  ConflictException,
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
import { Prisma, UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { CreateGradeDto, UpdateGradeDto } from './academics.dto';

@ApiTags('academics-grades')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('grades')
export class GradesController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async list() {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.grade.findMany({ orderBy: { sequence: 'asc' } }),
    );
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async one(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const grade = await withTenant(schoolId, (tx) => tx.grade.findUnique({ where: { id } }));
    if (!grade) throw new NotFoundException();
    return grade;
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  async create(@Body() dto: CreateGradeDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.grade.create({
          data: { schoolId, name: dto.name, sequence: dto.sequence, isActive: dto.isActive ?? true },
        }),
      );
    } catch (e) {
      throwOnUnique(e);
    }
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateGradeDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.grade.update({ where: { id }, data: dto }),
      );
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
      await withTenant(schoolId, (tx) => tx.grade.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throwOnNotFound(e);
    }
  }
}

export function throwOnUnique(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(`Unique constraint: ${(e.meta as { target?: string[] } | undefined)?.target?.join(', ') ?? 'duplicate'}`);
  }
  throw e as Error;
}
export function throwOnNotFound(e: unknown): void {
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2025' || e.code === 'P2001')) {
    throw new NotFoundException();
  }
}
