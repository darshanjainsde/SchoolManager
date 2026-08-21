import type { HallOfFameEntryDto } from './cms.dto';
export declare class HallOfFameService {
    list(schoolId: string): Promise<{
        name: string;
        id: string;
        schoolId: string;
        photoAssetId: string | null;
        year: string | null;
        rank: number;
        courseId: string;
        achievement: string | null;
    }[]>;
    /** Replace the (≤3) podium entries for one course. */
    setForCourse(schoolId: string, courseId: string, entries: HallOfFameEntryDto[]): Promise<{
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
//# sourceMappingURL=hall-of-fame.service.d.ts.map