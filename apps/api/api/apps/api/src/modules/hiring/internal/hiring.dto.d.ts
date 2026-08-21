declare const EMPLOYMENT: readonly ["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY"];
declare const KINDS: readonly ["CHOICE", "YES_NO", "NUMBER", "TEXT"];
export declare class JobQuestionDto {
    prompt: string;
    kind: (typeof KINDS)[number];
    /** CHOICE only; ignored for every other kind. */
    options?: string[];
    required?: boolean;
}
export declare class CreateJobDto {
    title: string;
    summary: string;
    description: string;
    employmentType?: (typeof EMPLOYMENT)[number];
    subject?: string;
    /** How many people are needed. Not a boolean — schools hire in batches. */
    posts?: number;
    salaryMinMinor?: number;
    salaryMaxMinor?: number;
    currency?: string;
    applyBy?: string;
    /** The cap is also enforced in the service — a builder is skippable. */
    questions?: JobQuestionDto[];
}
export declare class UpdateJobDto extends CreateJobDto {
    title: string;
    summary: string;
    description: string;
}
export declare class ModerateJobDto {
    decision: 'APPROVE' | 'REJECT';
    /** Required on REJECT — a refusal with no reason cannot be acted on. */
    reason?: string;
}
/**
 * What a stranger may say about themselves.
 *
 * Deliberately absent: schoolId and jobPostId. Both come from the vacancy the
 * application was posted against, so nothing in this body can file a candidate
 * into a school it names.
 */
export declare class ApplyDto {
    name: string;
    email: string;
    phone?: string;
    /** A LINK, not a file — there is no public upload endpoint in this product. */
    cvUrl: string;
    answers?: Record<string, string | number | boolean>;
}
export declare class SetApplicationStatusDto {
    status?: string;
    note?: string;
}
export {};
//# sourceMappingURL=hiring.dto.d.ts.map