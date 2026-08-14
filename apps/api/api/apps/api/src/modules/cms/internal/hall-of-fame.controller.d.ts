import { TenantContextService } from '../../tenancy';
import { HallOfFameService } from './hall-of-fame.service';
import { SetHallOfFameDto } from './cms.dto';
export declare class HallOfFameController {
    private readonly hof;
    private readonly tenant;
    constructor(hof: HallOfFameService, tenant: TenantContextService);
    private sid;
    list(): Promise<{
        name: string;
        id: string;
        schoolId: string;
        photoAssetId: string | null;
        year: string | null;
        rank: number;
        courseId: string;
        achievement: string | null;
    }[]>;
    setForCourse(courseId: string, dto: SetHallOfFameDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        photoAssetId: string | null;
        year: string | null;
        rank: number;
        courseId: string;
        achievement: string | null;
    }[]>;
}
//# sourceMappingURL=hall-of-fame.controller.d.ts.map