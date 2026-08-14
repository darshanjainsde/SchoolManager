import type { AdmissionStepDto, UpdateAdmissionsSettingsDto } from './cms.dto';
export declare class AdmissionsService {
    get(schoolId: string): Promise<{
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
    setSteps(schoolId: string, steps: AdmissionStepDto[]): Promise<{
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
    updateSettings(schoolId: string, dto: UpdateAdmissionsSettingsDto): Promise<{
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
//# sourceMappingURL=admissions.service.d.ts.map