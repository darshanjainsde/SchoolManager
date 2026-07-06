import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { AdmissionStepDto, UpdateAdmissionsSettingsDto } from './cms.dto';

@Injectable()
export class AdmissionsService {
  get(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [steps, settings] = await Promise.all([
        tx.admissionStep.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.admissionsSettings.findUnique({ where: { schoolId } }),
      ]);
      return {
        steps,
        settings: settings ?? { showFeesPublicly: true, feeNote: null },
      };
    });
  }

  async setSteps(schoolId: string, steps: AdmissionStepDto[]) {
    await withTenant(schoolId, async (tx) => {
      await tx.admissionStep.deleteMany({ where: { schoolId } });
      if (steps.length)
        await tx.admissionStep.createMany({
          data: steps.map((s) => ({ ...s, schoolId })),
        });
    });
    return this.get(schoolId);
  }

  async updateSettings(schoolId: string, dto: UpdateAdmissionsSettingsDto) {
    await withTenant(schoolId, (tx) =>
      tx.admissionsSettings.upsert({
        where: { schoolId },
        create: { ...dto, schoolId },
        update: dto,
      }),
    );
    return this.get(schoolId);
  }
}
