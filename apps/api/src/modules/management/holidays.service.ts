import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { HOLIDAY_TYPES, type Holiday } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2025 } from '../../common/errors/prisma-errors';
import { todayIstDateStr } from './internal/leave-dates';
import type { CreateHolidayDto } from './management.dto';

export type { Holiday };

@Injectable()
export class HolidaysService {
  /**
   * Prisma types `Holiday.startDate`/`endDate` (`@db.Date`) as `Date`; the
   * shared `Holiday` contract (`@skoolos/types`) types them as ISO strings —
   * the shape every consumer (web, mobile) actually receives once Nest's
   * JSON serializer runs `Date.prototype.toJSON`. Converting here makes the
   * service's own return type match the wire contract instead of leaving the
   * two silently out of sync.
   */
  private static toRow(r: {
    id: string;
    name: string;
    type: string;
    startDate: Date;
    endDate: Date | null;
  }): Holiday {
    return {
      id: r.id,
      name: r.name,
      type: r.type as Holiday['type'],
      startDate: r.startDate.toISOString(),
      endDate: r.endDate ? r.endDate.toISOString() : null,
    };
  }

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

    const row = await withTenant(schoolId, (tx) =>
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
    return HolidaysService.toRow(row);
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

    const rows = await withTenant(schoolId, (tx) =>
      tx.holiday.findMany({
        where: { schoolId, startDate: { gte: todayUtcMidnight } },
        orderBy: { startDate: 'asc' },
      }),
    );
    return rows.map(HolidaysService.toRow);
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
