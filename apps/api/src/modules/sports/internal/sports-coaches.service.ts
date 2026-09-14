import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { SPORTS_PERMS, effectiveSportsPerms, type SportsPerm } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

export interface CoachRow { id: string; name: string; email: string | null; isActive: boolean; hasLogin: boolean; perms: SportsPerm[]; stored: boolean }

/**
 * Admin → Sports → Teachers. The job itself (Staff.role = SPORTS) is set on
 * the Staff page like any other job; this is where the admin decides what
 * each sports teacher may do on the desk.
 */
@Injectable()
export class SportsCoachesService {
  list(schoolId: string): Promise<CoachRow[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.staff.findMany({
        take: LIST_CEILING.ROSTER, where: { schoolId, role: 'SPORTS' }, orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true, userId: true, sportsPerms: true },
      });
      return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), email: r.email, isActive: r.isActive, hasLogin: !!r.userId, perms: effectiveSportsPerms(r.sportsPerms), stored: r.sportsPerms.length > 0 }));
    });
  }

  async setPerms(schoolId: string, staffId: string, perms: string[]): Promise<{ perms: SportsPerm[] }> {
    const clean = [...new Set(perms.filter((p): p is SportsPerm => (SPORTS_PERMS as readonly string[]).includes(p)))];
    if (!clean.length) throw new ApiError('VALIDATION', 'Keep at least one permission, or change the job instead.', 400, 'sportsPerms');
    return withTenant(schoolId, async (tx) => {
      const r = await tx.staff.updateMany({ where: { id: staffId, schoolId, role: 'SPORTS' }, data: { sportsPerms: clean } });
      if (r.count === 0) throw new ApiError('COACH_NOT_FOUND', 'That staff member is not a sports teacher here.', 404);
      return { perms: clean };
    });
  }
}
