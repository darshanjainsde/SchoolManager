import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';

/**
 * WHO MAY SEE A SALARY.
 *
 * Everywhere else in the console, "school admin" is the whole answer. Pay is
 * the first place where it is the wrong one: a head of department with admin
 * rights has no business reading the principal's salary, and a school that
 * cannot separate the two will not put its payroll in our product at all.
 *
 * So the right is a per-user flag, not a role. The school's earliest admin
 * holds it from the migration; they grant it to anyone else by name, and both
 * the grant and every read of a salary screen are written to the audit log.
 *
 * Read from the PLATFORM client on purpose: `User` is not an RLS-scoped tenant
 * table, and the guard runs before a tenant transaction exists.
 */
@Injectable()
export class SalaryGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role !== 'SCHOOL_ADMIN') {
      throw new ApiError('NOT_SALARY_ADMIN', 'Only a school admin can open Salary.', 403);
    }
    const row = await getPlatformPrisma().user.findFirst({
      where: { id: user.sub, schoolId: user.schoolId, isActive: true },
      select: { canSeeSalary: true },
    });
    if (!row?.canSeeSalary) {
      throw new ApiError(
        'NOT_SALARY_ADMIN',
        'You do not have access to Salary. An admin who already has it can give it to you from Salary → People.',
        403,
      );
    }
    return true;
  }
}
