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
    const db = getPlatformPrisma();

    // AN ACCOUNTS OFFICER IS NOT AN ADMIN, and does not need to be.
    //
    // Their JOB opens the door — `Staff.role = ACCOUNTS`, the same pattern the
    // librarian and the sports desk use — but the door is not the right. They
    // still need `canSeeSalary`, granted to them by name, exactly as an admin
    // does. A school that makes someone an accounts officer has not thereby
    // shown them the principal's salary.
    if (user.role === 'STAFF') {
      const staff = await db.staff.findFirst({
        where: { userId: user.sub, schoolId: user.schoolId, isActive: true },
        select: { role: true },
      });
      if (staff?.role !== 'ACCOUNTS') {
        throw new ApiError('NOT_SALARY_ADMIN', 'Only a school admin or an accounts officer can open Pay.', 403);
      }
      const me = await db.user.findFirst({
        where: { id: user.sub, schoolId: user.schoolId, isActive: true },
        select: { canSeeSalary: true },
      });
      if (me?.canSeeSalary) return true;
      throw new ApiError(
        'NOT_SALARY_ADMIN',
        'You are the accounts officer, but nobody has given you the right to see pay yet. An admin grants it under Pay \u2192 Settings.',
        403,
      );
    }

    if (user.role !== 'SCHOOL_ADMIN') {
      throw new ApiError('NOT_SALARY_ADMIN', 'Only a school admin or an accounts officer can open Pay.', 403);
    }
    const row = await db.user.findFirst({
      where: { id: user.sub, schoolId: user.schoolId, isActive: true },
      select: { canSeeSalary: true },
    });
    if (row?.canSeeSalary) return true;

    // SELF-HEALING FIRST HOLDER. Admins only — an accounts officer is never
    // the first holder, because the right has to come from somebody. The migration granted this to each existing
    // school's earliest admin, but a school created afterwards has nobody —
    // and a right only an existing holder can grant would leave that school a
    // locked room with the key inside. So: if NO admin here holds it, the
    // earliest one does, and we write it down rather than deciding it again on
    // every request.
    const anyHolder = await db.user.count({
      where: { schoolId: user.schoolId, role: 'SCHOOL_ADMIN', isActive: true, canSeeSalary: true },
    });
    if (anyHolder === 0) {
      const first = await db.user.findFirst({
        where: { schoolId: user.schoolId, role: 'SCHOOL_ADMIN', isActive: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (first?.id === user.sub) {
        await db.user.update({ where: { id: first.id }, data: { canSeeSalary: true } });
        return true;
      }
    }

    throw new ApiError(
      'NOT_SALARY_ADMIN',
      'You do not have access to Salary. An admin who already has it can give it to you from Salary → Settings.',
      403,
    );
  }
}
