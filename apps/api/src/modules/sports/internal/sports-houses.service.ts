import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { isP2002 } from '../../../common/errors/prisma-errors';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { activeStudentsWhere } from '../../../common/roster/active-students';
import type { AssignHouseDto, AwardPointsDto, CreateHouseDto, UpdateHouseDto } from './sports.dto';

export interface HouseRow { id: string; name: string; color: string; order: number; members: number; points: number }
export interface PointRow { id: string; houseId: string; points: number; reason: string; eventId: string | null; createdAt: Date }

/**
 * Houses and the points table. Points are ROWS, never a running total: a
 * correction is another row with a reason, so the table is always the sum of
 * a ledger anyone can read.
 */
@Injectable()
export class SportsHousesService {
  list(schoolId: string): Promise<HouseRow[]> {
    return withTenant(schoolId, async (tx) => {
      const [houses, points, members] = await Promise.all([
        tx.house.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
        tx.housePoint.groupBy({ by: ['houseId'], where: { schoolId }, _sum: { points: true } }),
        tx.student.groupBy({ by: ['houseId'], where: activeStudentsWhere(schoolId, { houseId: { not: null } }), _count: { _all: true } }),
      ]);
      const sum = new Map(points.map((p) => [p.houseId, p._sum.points ?? 0]));
      const count = new Map(members.map((m) => [m.houseId, m._count._all]));
      return houses.map((h) => ({ id: h.id, name: h.name, color: h.color, order: h.order, members: count.get(h.id) ?? 0, points: sum.get(h.id) ?? 0 }));
    });
  }

  create(schoolId: string, dto: CreateHouseDto): Promise<{ id: string }> {
    return withTenant(schoolId, async (tx) => {
      const order = await tx.house.count({ where: { schoolId } });
      try {
        const h = await tx.house.create({ data: { schoolId, name: dto.name.trim(), color: dto.color ?? '#4F46E5', order }, select: { id: true } });
        return h;
      } catch (e) {
        if (isP2002(e)) throw new ApiError('HOUSE_EXISTS', `There is already a house called "${dto.name.trim()}".`, 409, 'name');
        throw e;
      }
    });
  }

  update(schoolId: string, id: string, dto: UpdateHouseDto): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      await this.require(tx, schoolId, id);
      try {
        await tx.house.update({
          where: { id },
          data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.color ? { color: dto.color } : {}), ...(dto.order != null ? { order: dto.order } : {}) },
        });
      } catch (e) {
        if (isP2002(e)) throw new ApiError('HOUSE_EXISTS', 'Another house already has that name.', 409, 'name');
        throw e;
      }
    });
  }

  /** Delete only a house with no points; students simply lose the house (FK SET NULL). */
  remove(schoolId: string, id: string): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      await this.require(tx, schoolId, id);
      const awarded = await tx.housePoint.count({ where: { schoolId, houseId: id } });
      if (awarded > 0) throw new ApiError('HOUSE_IN_USE', 'This house has points on the table. Correct the points instead of deleting the house.', 409);
      await tx.house.delete({ where: { id } });
    });
  }

  /** Put students in a house (or take them out with null). Only this school's students move. */
  assign(schoolId: string, dto: AssignHouseDto): Promise<{ moved: number }> {
    return withTenant(schoolId, async (tx) => {
      if (dto.houseId) await this.require(tx, schoolId, dto.houseId);
      const r = await tx.student.updateMany({ where: { schoolId, id: { in: dto.studentIds } }, data: { houseId: dto.houseId } });
      return { moved: r.count };
    });
  }

  members(schoolId: string, houseId: string) {
    return withTenant(schoolId, async (tx) => {
      await this.require(tx, schoolId, houseId);
      return tx.student.findMany({
        take: LIST_CEILING.ROSTER,
        where: activeStudentsWhere(schoolId, { houseId }),
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
      });
    });
  }

  async award(schoolId: string, houseId: string, dto: AwardPointsDto): Promise<{ id: string }> {
    if (dto.points === 0) throw new ApiError('VALIDATION', 'Zero points is not an award.', 400, 'points');
    return withTenant(schoolId, async (tx) => {
      await this.require(tx, schoolId, houseId);
      return tx.housePoint.create({ data: { schoolId, houseId, points: dto.points, reason: dto.reason.trim() }, select: { id: true } });
    });
  }

  /** Used by the results service inside its own transaction: one row per placing. */
  async awardMany(tx: TenantTx, schoolId: string, rows: { houseId: string; points: number; reason: string; eventId: string }[]): Promise<number> {
    const real = rows.filter((r) => r.points !== 0);
    if (!real.length) return 0;
    const r = await tx.housePoint.createMany({ data: real.map((x) => ({ schoolId, ...x })) });
    return r.count;
  }

  ledger(schoolId: string, houseId?: string): Promise<PointRow[]> {
    return withTenant(schoolId, (tx) =>
      tx.housePoint.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, ...(houseId ? { houseId } : {}) },
        orderBy: { createdAt: 'desc' },
        select: { id: true, houseId: true, points: true, reason: true, eventId: true, createdAt: true },
      }),
    );
  }

  private async require(tx: TenantTx, schoolId: string, id: string): Promise<void> {
    const h = await tx.house.findFirst({ where: { id, schoolId }, select: { id: true } });
    if (!h) throw new ApiError('HOUSE_NOT_FOUND', 'That house is not in this school.', 404);
  }
}
