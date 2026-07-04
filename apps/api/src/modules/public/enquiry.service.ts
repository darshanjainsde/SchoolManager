import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { SubmitEnquiryDto } from './public.dto';

@Injectable()
export class EnquiryService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  async submit(dto: SubmitEnquiryDto) {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Site not found');
    const schoolId = ctx.schoolId;

    const feat = await this.features.getFeatures(schoolId);
    if (!feat.has('ENQUIRY')) throw new NotFoundException('Enquiry not available');

    return withTenant(schoolId, (tx) =>
      tx.enquiry.create({
        data: {
          schoolId,
          parentName: dto.parentName,
          phone: dto.phone,
          email: dto.email,
          gradeInterest: dto.gradeInterest,
          message: dto.message,
          status: 'NEW',
        },
      }),
    );
  }

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.enquiry.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async setStatus(schoolId: string, id: string, status: 'NEW' | 'CONTACTED' | 'CLOSED') {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');
      return tx.enquiry.update({
        where: { id },
        data: { status },
      });
    });
  }
}
