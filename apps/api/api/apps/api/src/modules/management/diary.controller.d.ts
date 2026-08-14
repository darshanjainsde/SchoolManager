import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { DiaryService } from './diary.service';
import { CreateDiaryEntryDto, UpdateDiaryEntryDto } from './management.dto';
/**
 * The teacher's side of the Daily Diary. The family's side lives on
 * `/me/diary` in `PortalController`; the attendance bar that shares this
 * phase's pitch lives on `AttendanceController`, next to the register it
 * reads from.
 */
export declare class DiaryController {
    private readonly diary;
    private readonly tenant;
    constructor(diary: DiaryService, tenant: TenantContextService);
    private sid;
    /** One class's diary page for one day. */
    page(classSectionId: string, date: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").DiaryPageResult>;
    create(dto: CreateDiaryEntryDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").DiaryEntryRow>;
    update(id: string, dto: UpdateDiaryEntryDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").DiaryEntryRow>;
    remove(id: string, u: SchoolJwtPayload): Promise<void>;
}
//# sourceMappingURL=diary.controller.d.ts.map