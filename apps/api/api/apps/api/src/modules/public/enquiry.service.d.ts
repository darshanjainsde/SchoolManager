import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { SubmitEnquiryDto } from './public.dto';
export declare class EnquiryService {
    private readonly tenant;
    private readonly features;
    constructor(tenant: TenantContextService, features: FeatureResolverService);
    submit(dto: SubmitEnquiryDto): Promise<{
        status: import("@skoolos/db").$Enums.EnquiryStatus;
        message: string | null;
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        phone: string;
        parentName: string;
        gradeInterest: string | null;
    }>;
    list(schoolId: string): Promise<{
        status: import("@skoolos/db").$Enums.EnquiryStatus;
        message: string | null;
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        phone: string;
        parentName: string;
        gradeInterest: string | null;
    }[]>;
    setStatus(schoolId: string, id: string, status: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<{
        status: import("@skoolos/db").$Enums.EnquiryStatus;
        message: string | null;
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        phone: string;
        parentName: string;
        gradeInterest: string | null;
    }>;
}
//# sourceMappingURL=enquiry.service.d.ts.map