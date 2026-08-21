import { ModerateEventDto, OwnerCreateEventDto } from './owner.dto';
export declare class OwnerEventsService {
    listNetwork(status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<({
        school: {
            name: string;
            slug: string;
        };
    } & {
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
    })[]>;
    moderate(id: string, dto: ModerateEventDto, ownerUserId: string): Promise<{
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
    createNetwork(dto: OwnerCreateEventDto, ownerUserId: string): Promise<{
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
}
//# sourceMappingURL=owner-events.service.d.ts.map