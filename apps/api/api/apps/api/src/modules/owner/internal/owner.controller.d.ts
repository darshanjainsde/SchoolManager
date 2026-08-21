import type { Response } from 'express';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { MarketingService, SetLeadStatusDto, UpdateMarketingConfigDto } from '../../marketing';
import { JobsService } from '../../hiring';
import { ModerateJobDto } from './owner.dto';
import { CreateSchoolDto, ModerateEventDto, OwnerCreateEventDto, SetFeatureDto, SetStatusDto, SetTierDto } from './owner.dto';
import { ImpersonationService } from './impersonation.service';
import { OwnerEventsService } from './owner-events.service';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerSchoolsService } from './owner-schools.service';
export declare class OwnerController {
    private readonly schools;
    private readonly ownerEvents;
    private readonly impersonation;
    private readonly overviewSvc;
    private readonly marketing;
    private readonly jobs;
    constructor(schools: OwnerSchoolsService, ownerEvents: OwnerEventsService, impersonation: ImpersonationService, overviewSvc: OwnerOverviewService, marketing: MarketingService, jobs: JobsService);
    overview(): Promise<import("./owner-overview.service").OverviewResponse>;
    listLeads(status?: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<{
        status: import("@skoolos/db").$Enums.LeadStatus;
        name: string | null;
        school: string | null;
        id: string;
        createdAt: Date;
        phone: string;
        interest: string | null;
        source: string;
    }[]>;
    setLeadStatus(id: string, dto: SetLeadStatusDto): Promise<{
        status: import("@skoolos/db").$Enums.LeadStatus;
        name: string | null;
        school: string | null;
        id: string;
        createdAt: Date;
        phone: string;
        interest: string | null;
        source: string;
    }>;
    marketingConfig(): Promise<{
        id: string;
        updatedAt: Date;
        priceBasicUsd: number;
        priceBasicInr: number;
        priceStdUsd: number;
        priceStdInr: number;
        priceProUsd: number;
        priceProInr: number;
        contactEmail: string;
        contactPhone: string;
    }>;
    updateMarketingConfig(dto: UpdateMarketingConfigDto): Promise<{
        id: string;
        updatedAt: Date;
        priceBasicUsd: number;
        priceBasicInr: number;
        priceStdUsd: number;
        priceStdInr: number;
        priceProUsd: number;
        priceProInr: number;
        contactEmail: string;
        contactPhone: string;
    }>;
    enquiriesCsv(id: string, res: Response): Promise<void>;
    stats(): Promise<import("./owner-schools.service").StatsResponse>;
    listSchools(): Promise<import("./owner-schools.service").SchoolRow[]>;
    schoolDetail(id: string): Promise<import("./owner-schools.service").SchoolDetail>;
    createSchool(dto: CreateSchoolDto): Promise<{
        id: string;
        slug: string;
        tempPassword: string;
    }>;
    setTier(id: string, dto: SetTierDto): Promise<import("./owner-schools.service").SchoolDetail>;
    setFeature(id: string, dto: SetFeatureDto): Promise<import("./owner-schools.service").SchoolDetail>;
    setStatus(id: string, dto: SetStatusDto): Promise<import("./owner-schools.service").SchoolDetail>;
    deleteSchool(id: string): Promise<{
        ok: true;
    }>;
    impersonate(id: string): Promise<{
        url: string;
        expiresInSeconds: number;
    }>;
    listEvents(status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<({
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
    /**
     * The vacancy queue. The SAME desk as network events, deliberately — §6 of
     * the Phase 6 plan: a second moderation queue is how one of them stops being
     * read.
     *
     * The owner moderates VACANCIES and never sees an application. There is no
     * endpoint here that returns a candidate, and JobApplication carries no
     * owner read policy.
     */
    listJobs(status?: string): Promise<({
        school: {
            name: string;
            slug: string;
        };
        questions: {
            options: string[];
            kind: import("@skoolos/db").$Enums.JobQuestionKind;
            id: string;
            createdAt: Date;
            schoolId: string;
            order: number;
            jobPostId: string;
            prompt: string;
            required: boolean;
        }[];
    } & {
        status: import("@skoolos/db").$Enums.JobStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        schoolId: string;
        subject: string | null;
        title: string;
        description: string;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
        currency: string;
        summary: string;
        employmentType: import("@skoolos/db").$Enums.EmploymentType;
        posts: number;
        salaryMinMinor: number | null;
        salaryMaxMinor: number | null;
        applyBy: Date | null;
        rejectedReason: string | null;
    })[]>;
    moderateJob(id: string, dto: ModerateJobDto): Promise<{
        status: import("@skoolos/db").$Enums.JobStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        schoolId: string;
        subject: string | null;
        title: string;
        description: string;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
        currency: string;
        summary: string;
        employmentType: import("@skoolos/db").$Enums.EmploymentType;
        posts: number;
        salaryMinMinor: number | null;
        salaryMaxMinor: number | null;
        applyBy: Date | null;
        rejectedReason: string | null;
    }>;
    moderate(id: string, dto: ModerateEventDto, user: PlatformJwtPayload): Promise<{
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
    createEvent(dto: OwnerCreateEventDto, user: PlatformJwtPayload): Promise<{
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
//# sourceMappingURL=owner.controller.d.ts.map