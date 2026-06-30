import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from './tenant-context.service';

/**
 * Minimal people endpoints. Implemented in Phase 1 to (a) demonstrate the
 * two-layer authz pattern and (b) give the security tests something concrete
 * to attack. Full CRUD ships in Phase 3 (school admin core).
 *
 * The authz pattern, top to bottom, is:
 *   1. SchoolJwtGuard       — valid JWT, schoolId matches the host
 *   2. RolesGuard           — role allowed on this endpoint
 *   3. Tenant-scoped query  — withTenant(ctx.schoolId, ...) → RLS in Postgres
 *   4. Ownership check      — for "self-only" paths, compare resource owner
 *                             to JWT subject and 404 (not 403) when wrong, so
 *                             enumeration doesn't reveal which IDs exist.
 */
@ApiTags('directory')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class UsersController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  // List users in this school — restricted to admins/teachers/staff.
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  @Get('users')
  async listUsers() {
    const ctx = this.tenantCtx.requireTenant();
    return withTenant(ctx.schoolId, (tx) =>
      tx.user.findMany({
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
        orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      }),
    );
  }

  // List students — admins/teachers/staff only.
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  @Get('students')
  async listStudents() {
    const ctx = this.tenantCtx.requireTenant();
    return withTenant(ctx.schoolId, (tx) =>
      tx.user.findMany({
        where: { role: UserRole.STUDENT },
        select: { id: true, email: true, firstName: true, lastName: true },
        orderBy: { lastName: 'asc' },
      }),
    );
  }

  // Read a single student — admins/teachers/staff for any in-tenant student,
  // or the student themselves (parents not in Phase 1; added in Phase 6).
  @Get('students/:id')
  async getStudent(@Param('id') id: string, @CurrentUser() user: SchoolJwtPayload) {
    const ctx = this.tenantCtx.requireTenant();
    const row = await withTenant(ctx.schoolId, (tx) =>
      tx.user.findFirst({
        where: { id, role: UserRole.STUDENT },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    );
    if (!row) throw new NotFoundException();

    const canRead =
      user.role === UserRole.SCHOOL_ADMIN ||
      user.role === UserRole.TEACHER ||
      user.role === UserRole.STAFF ||
      (user.role === UserRole.STUDENT && user.sub === row.id);

    // Use 404 (not 403) for unauthorized reads so existence isn't leaked
    // through enumeration of IDs that belong to other students.
    if (!canRead) throw new NotFoundException();
    return row;
  }

  // Read a teacher — admin/staff or self.
  @Get('teachers/:id')
  async getTeacher(@Param('id') id: string, @CurrentUser() user: SchoolJwtPayload) {
    const ctx = this.tenantCtx.requireTenant();
    const row = await withTenant(ctx.schoolId, (tx) =>
      tx.user.findFirst({
        where: { id, role: UserRole.TEACHER },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    );
    if (!row) throw new NotFoundException();

    const canRead =
      user.role === UserRole.SCHOOL_ADMIN ||
      user.role === UserRole.STAFF ||
      (user.role === UserRole.TEACHER && user.sub === row.id);

    if (!canRead) throw new NotFoundException();
    return row;
  }

  // Read any in-tenant user — admin/staff for any, self for own row.
  @Get('users/:id')
  async getUser(@Param('id') id: string, @CurrentUser() user: SchoolJwtPayload) {
    if (user.role !== UserRole.SCHOOL_ADMIN && user.role !== UserRole.STAFF && user.sub !== id) {
      throw new ForbiddenException();
    }
    const ctx = this.tenantCtx.requireTenant();
    const row = await withTenant(ctx.schoolId, (tx) =>
      tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, firstName: true, lastName: true },
      }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }
}
