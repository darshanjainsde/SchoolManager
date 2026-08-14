import { TenantContextService } from '../tenancy';
import { CreateEventDto, UpdateEventDto } from './community.dto';
export declare class EventsService {
    private readonly tenant;
    constructor(tenant: TenantContextService);
    list(): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }[]>;
    create(dto: CreateEventDto): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }>;
    update(id: string, dto: UpdateEventDto): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=events.service.d.ts.map