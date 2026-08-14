import { EnquiryService } from './enquiry.service';
import { SubmitEnquiryDto } from './public.dto';
export declare class EnquiryController {
    private readonly enquiry;
    constructor(enquiry: EnquiryService);
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
}
//# sourceMappingURL=enquiry.controller.d.ts.map