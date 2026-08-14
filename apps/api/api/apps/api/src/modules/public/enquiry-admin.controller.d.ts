import { TenantContextService } from '../tenancy';
import { EnquiryService } from './enquiry.service';
import { SetEnquiryStatusDto } from './public.dto';
export declare class EnquiryAdminController {
    private readonly enquiry;
    private readonly tenant;
    constructor(enquiry: EnquiryService, tenant: TenantContextService);
    private sid;
    list(): Promise<{
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
    setStatus(id: string, dto: SetEnquiryStatusDto): Promise<{
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
//# sourceMappingURL=enquiry-admin.controller.d.ts.map