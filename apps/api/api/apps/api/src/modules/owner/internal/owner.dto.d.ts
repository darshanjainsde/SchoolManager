export declare class OwnerLoginDto {
    email: string;
    password: string;
    totp?: string;
}
export declare class RefreshDto {
    /** Optional: the token normally arrives as an HttpOnly cookie. The body form
     *  is kept so sessions created before the cookie shipped can still refresh. */
    refreshToken?: string;
}
export declare class GateLoginDto {
    password: string;
}
export declare class CreateSchoolDto {
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    domainHostname: string;
    adminEmail: string;
}
export declare class SetTierDto {
    tier: 'BASIC' | 'STANDARD' | 'PRO';
}
export declare class SetStatusDto {
    status: 'SETUP' | 'LIVE' | 'SUSPENDED';
}
export declare class SetFeatureDto {
    featureKey: string;
    enabled: boolean;
}
export declare class ModerateEventDto {
    action: 'APPROVE' | 'REJECT';
}
export declare class OwnerCreateEventDto {
    schoolId: string;
    title: string;
    description?: string;
    startAt: string;
    endAt?: string;
    venue?: string;
}
/**
 * The owner's decision on a vacancy. Declared HERE, not imported from the
 * hiring module: a DTO belongs to the module whose controller consumes it, and
 * the boundary rule forbids reaching into another module's internals.
 */
export declare class ModerateJobDto {
    decision: 'APPROVE' | 'REJECT';
    /** Required on REJECT — a refusal with no reason cannot be acted on. */
    reason?: string;
}
//# sourceMappingURL=owner.dto.d.ts.map