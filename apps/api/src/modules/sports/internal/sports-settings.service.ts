import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx, type SportsSettings } from '@skoolos/db';
import { DEFAULT_BANDS, validateBands, type Band } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { isP2002 } from '../../../common/errors/prisma-errors';
import type { UpdateSportsSettingsDto } from './sports.dto';

export interface SportsSettingsView {
  grouping: 'BANDS' | 'AGE';
  bands: Band[];
  pointsPlacing: number[];
  pointsMatchWin: number;
  pointsClassWin: number;
  publishNeedsAdmin: boolean;
}

/**
 * One `SportsSettings` row per school, created on first read with the
 * schema defaults (three bands, 10-7-5-3-2-1 placing points, a match win 5,
 * a class win 3, publishing open to the teacher). The teacher with SETTINGS
 * and the admin edit the SAME row.
 */
@Injectable()
export class SportsSettingsService {
  async ensure(tx: TenantTx, schoolId: string): Promise<SportsSettings> {
    const existing = await tx.sportsSettings.findUnique({ where: { schoolId } });
    if (existing) return existing;
    try {
      return await tx.sportsSettings.create({ data: { schoolId } });
    } catch (e) {
      if (isP2002(e)) {
        const row = await tx.sportsSettings.findUnique({ where: { schoolId } });
        if (row) return row;
      }
      throw e;
    }
  }

  view(row: SportsSettings): SportsSettingsView {
    const bands = validateBands(row.bands) ? DEFAULT_BANDS : (row.bands as unknown as Band[]);
    return {
      grouping: row.grouping === 'AGE' ? 'AGE' : 'BANDS',
      bands,
      pointsPlacing: row.pointsPlacing,
      pointsMatchWin: row.pointsMatchWin,
      pointsClassWin: row.pointsClassWin,
      publishNeedsAdmin: row.publishNeedsAdmin,
    };
  }

  get(schoolId: string): Promise<SportsSettingsView> {
    return withTenant(schoolId, async (tx) => this.view(await this.ensure(tx, schoolId)));
  }

  async update(schoolId: string, dto: UpdateSportsSettingsDto): Promise<SportsSettingsView> {
    if (dto.bands) {
      const problem = validateBands(dto.bands);
      if (problem) throw new ApiError('SPORTS_BAD_BANDS', problem, 400, 'bands');
    }
    return withTenant(schoolId, async (tx) => {
      await this.ensure(tx, schoolId);
      const row = await tx.sportsSettings.update({
        where: { schoolId },
        data: {
          ...(dto.grouping ? { grouping: dto.grouping } : {}),
          ...(dto.bands ? { bands: dto.bands as unknown as object } : {}),
          ...(dto.pointsPlacing ? { pointsPlacing: dto.pointsPlacing } : {}),
          ...(dto.pointsMatchWin != null ? { pointsMatchWin: dto.pointsMatchWin } : {}),
          ...(dto.pointsClassWin != null ? { pointsClassWin: dto.pointsClassWin } : {}),
          ...(dto.publishNeedsAdmin != null ? { publishNeedsAdmin: dto.publishNeedsAdmin } : {}),
        },
      });
      return this.view(row);
    });
  }
}
