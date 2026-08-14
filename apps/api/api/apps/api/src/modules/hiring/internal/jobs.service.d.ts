import { Prisma } from '@skoolos/db';
import { TenantContextService } from '../../tenancy';
import type { ApplyDto, CreateJobDto, ModerateJobDto, UpdateJobDto } from './hiring.dto';
/** Four questions maximum. The cost lands on the candidate; the benefit on the admin. */
export declare const MAX_QUESTIONS = 4;
/**
 * Vacancies, their screening questions, and the applications against them.
 *
 * Hiring appears ONLY on sckools.com. That host resolves to the platform, not
 * to a school, so the public half of this service has NO tenant context and
 * runs on the platform connection with RLS bypassed. Everything the school
 * itself reads runs under `withTenant`, which is where the single-tenant rule
 * on applications actually bites.
 *
 * See docs/superpowers/specs/2026-08-05-hiring-design.md.
 */
export declare class JobsService {
    private readonly tenant;
    constructor(tenant: TenantContextService);
    list(): Promise<({
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
    create(dto: CreateJobDto): Promise<{
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
    update(id: string, dto: UpdateJobDto): Promise<{
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
    submit(id: string): Promise<{
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
    close(id: string): Promise<{
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
    /** The school's own applications. Tenant-scoped, which is the whole protection. */
    applications(jobPostId: string): Promise<{
        post: {
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
        };
        applications: {
            status: import("@skoolos/db").$Enums.JobApplicationStatus;
            name: string;
            email: string;
            id: string;
            createdAt: Date;
            schoolId: string;
            phone: string | null;
            jobPostId: string;
            cvUrl: string;
            answers: Prisma.JsonValue | null;
            note: string | null;
        }[];
    }>;
    setApplicationStatus(id: string, dto: {
        status?: string;
        note?: string;
    }): Promise<{
        status: import("@skoolos/db").$Enums.JobApplicationStatus;
        name: string;
        email: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        phone: string | null;
        jobPostId: string;
        cvUrl: string;
        answers: Prisma.JsonValue | null;
        note: string | null;
    }>;
    /** Runs on the platform connection: the owner has no tenant. */
    ownerList(status?: string): Promise<({
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
    moderate(id: string, dto: ModerateJobDto): Promise<{
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
    publicBoard(filters: {
        school?: string;
        employmentType?: string;
        subject?: string;
    }): Promise<{
        school: {
            name: string;
            slug: string;
        };
        id: string;
        createdAt: Date;
        subject: string | null;
        title: string;
        currency: string;
        summary: string;
        employmentType: import("@skoolos/db").$Enums.EmploymentType;
        posts: number;
        salaryMinMinor: number | null;
        salaryMaxMinor: number | null;
        applyBy: Date | null;
    }[]>;
    publicOne(id: string): Promise<{
        school: {
            name: string;
            slug: string;
        };
        id: string;
        subject: string | null;
        title: string;
        description: string;
        currency: string;
        summary: string;
        employmentType: import("@skoolos/db").$Enums.EmploymentType;
        posts: number;
        salaryMinMinor: number | null;
        salaryMaxMinor: number | null;
        applyBy: Date | null;
        questions: {
            options: string[];
            kind: import("@skoolos/db").$Enums.JobQuestionKind;
            id: string;
            prompt: string;
            required: boolean;
        }[];
    }>;
    /**
     * A stranger applying. THE GUARD IS THIS METHOD, not RLS.
     *
     * sckools.com has no tenant context, so this runs on the platform
     * connection. `schoolId` and `jobPostId` are therefore taken from the vacancy
     * row — never from the request — so a caller cannot file a candidate into a
     * school it names.
     */
    apply(jobPostId: string, dto: ApplyDto): Promise<{
        status: import("@skoolos/db").$Enums.JobApplicationStatus;
        name: string;
        email: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        phone: string | null;
        jobPostId: string;
        cvUrl: string;
        answers: Prisma.JsonValue | null;
        note: string | null;
    }>;
    private assertQuestionCount;
    private setStatus;
    private writeQuestions;
}
//# sourceMappingURL=jobs.service.d.ts.map