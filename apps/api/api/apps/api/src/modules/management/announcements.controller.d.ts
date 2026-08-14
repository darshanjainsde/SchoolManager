import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';
export declare class AnnouncementsController {
    private readonly svc;
    private readonly tenant;
    constructor(svc: AnnouncementsService, tenant: TenantContextService);
    private sid;
    list(): Promise<({
        classSection: {
            name: string;
        } | null;
    } & {
        body: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        classSectionId: string | null;
        createdByUserId: string | null;
    })[]>;
    mine(u: SchoolJwtPayload): Promise<import("@skoolos/types").AnnouncementMine[]>;
    create(dto: CreateAnnouncementDto, u: SchoolJwtPayload): Promise<{
        body: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        classSectionId: string | null;
        createdByUserId: string | null;
    }[]>;
    update(id: string, dto: UpdateAnnouncementDto, u: SchoolJwtPayload): Promise<{
        body: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        classSectionId: string | null;
        createdByUserId: string | null;
    }>;
    remove(id: string, u: SchoolJwtPayload): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=announcements.controller.d.ts.map