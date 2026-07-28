import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type Holiday } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { isP2025 } from '../../common/errors/prisma-errors';
import { todayIstDateStr } from './internal/leave-dates';
import { HOLIDAY_TYPES, type CreateHolidayDto } from './management.dto';

@Injectable()
export class HolidaysService {
  /**
   * Creates a school-configured holiday. `dto.type` already goes through
   * `@IsIn(HOLIDAY_TYPES)` at the controller boundary — this re-check is
   * defense in depth for any caller that reaches the service directly (unit
   * tests, future internal callers), mirroring `LeaveService.apply`'s own
   * `endDate < startDate` re-check ahead of `withTenant`.
   */
  async create(schoolId: string, dto: CreateHolidayDto): Promise<Holiday> {
    if (!(HOLIDAY_TYPES as readonly string[]).includes(dto.type)) {
      throw new ApiError('VALIDATION', 'type must be one of PUBLIC, FESTIVAL, SCHOOL', 400, 'type');
    }

    return withTenant(schoolId, (tx) =>
      tx.holiday.create({
        data: {
          schoolId,
          name: dto.name,
          type: dto.type,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        },
      }),
    );
  }

  /**
   * Upcoming holidays only — `startDate >= today` (IST calendar day, same
   * "today" boundary `LeaveService`/`PortalService` use elsewhere for
   * `@db.Date` comparisons) — ordered ascending so the nearest holiday is
   * first. The boundary is applied at the query itself, not filtered in JS
   * afterward, so a past holiday never leaves the database.
   */
  async list(schoolId: string): Promise<Holiday[]> {
    const todayUtcMidnight = new Date(`${todayIstDateStr(new Date())}T00:00:00.000Z`);

    return withTenant(schoolId, (tx) =>
      tx.holiday.findMany({
        where: { schoolId, startDate: { gte: todayUtcMidnight } },
        orderBy: { startDate: 'asc' },
      }),
    );
  }

  async remove(schoolId: string, id: string): Promise<{ ok: true }> {
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.holiday.delete({ where: { id } });
        return { ok: true as const };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Holiday not found');
        throw e;
      }
    });
  }
}
