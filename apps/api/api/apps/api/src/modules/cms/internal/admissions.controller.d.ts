import { TenantContextService } from '../../tenancy';
import { AdmissionsService } from './admissions.service';
import { SetAdmissionStepsDto, UpdateAdmissionsSettingsDto } from './cms.dto';
export declare class AdmissionsController {
    private readonly admissions;
    private readonly tenant;
    constructor(admissions: AdmissionsService, tenant: TenantContextService);
    private sid;
    get(): Promise<{
        steps: {
            id: string;
            schoolId: string;
            title: string;
            order: number;
            description: string | null;
        }[];
        settings: {
            id: string;
            schoolId: string;
            showFeesPublicly: boolean;
            feeNote: string | null;
        } | {
            showFeesPublicly: true;
            feeNote: null;
        };
    }>;
    setSteps(dto: SetAdmissionStepsDto): Promise<{
        steps: {
            id: string;
            schoolId: string;
            title: string;
            order: number;
            description: string | null;
        }[];
        settings: {
            id: string;
            schoolId: string;
            showFeesPublicly: boolean;
            feeNote: string | null;
        } | {
            showFeesPublicly: true;
            feeNote: null;
        };
    }>;
    updateSettings(dto: UpdateAdmissionsSettingsDto): Promise<{
        steps: {
            id: string;
            schoolId: string;
            title: string;
            order: number;
            description: string | null;
        }[];
        settings: {
            id: string;
            schoolId: string;
            showFeesPublicly: boolean;
            feeNote: string | null;
        } | {
            showFeesPublicly: true;
            feeNote: null;
        };
    }>;
}
//# sourceMappingURL=admissions.controller.d.ts.map