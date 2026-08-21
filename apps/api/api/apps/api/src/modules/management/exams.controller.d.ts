import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { ExamsService } from './exams.service';
import { CreateExamDto, SaveExamResultsDto } from './management.dto';
export declare class ExamsController {
    private readonly exams;
    private readonly tenant;
    constructor(exams: ExamsService, tenant: TenantContextService);
    private sid;
    create(dto: CreateExamDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").Exam>;
    list(classSectionId: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").ExamList>;
    /** Marks already stored for this exam — lets the entry screen prefill. */
    listResults(id: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").SavedResult[]>;
    saveResults(id: string, dto: SaveExamResultsDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").SaveResultsResponse>;
    publish(id: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").PublishResultsResponse>;
}
//# sourceMappingURL=exams.controller.d.ts.map