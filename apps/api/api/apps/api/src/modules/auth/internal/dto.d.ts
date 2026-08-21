export declare class LoginDto {
    /**
     * Either an email address or a student admission number. `email` is kept as
     * an optional alias so existing `{ email, password }` callers keep working.
     *
     * NOTE: `identifier` and `email` are validated independently (each is
     * type-checked whenever present, regardless of whether the other field is
     * also present). Do NOT reintroduce a mutual `@ValidateIf((dto) =>
     * !dto.other)` pattern here — when both fields are truthy, both predicates
     * evaluate false and NEITHER field gets type-checked, letting a
     * non-string value (e.g. `identifier: 123`) slip through validation and
     * crash `AuthService.login` with an uncaught TypeError (500) instead of a
     * clean 400. The "at least one of identifier/email must be present" rule
     * is instead enforced by the `identifierOrEmail` getter below, which is
     * never skipped by `@IsOptional()`.
     */
    identifier?: string;
    /**
     * `@IsEmail()` is intentionally NOT used: the admission-flow may reuse this
     * field for a non-RFC-strict value, so a plain string check is sufficient.
     */
    email?: string;
    password: string;
    /**
     * Virtual field (not sent by clients) that enforces "at least one of
     * identifier/email must be provided". It is intentionally NOT wrapped in
     * `@IsOptional()` so it is always validated, even when both `identifier`
     * and `email` are absent/undefined.
     */
    get identifierOrEmail(): string;
}
export declare class RefreshDto {
    /** Optional: the token normally arrives as an HttpOnly cookie. The body form
     *  is kept so sessions created before the cookie shipped can still refresh. */
    refreshToken?: string;
}
export declare class ForgotPasswordDto {
    email: string;
}
export declare class ResetPasswordDto {
    token: string;
    newPassword: string;
}
export declare class ImpersonateDto {
    token: string;
}
/** Phase 5·1 — password reset with only the RAF-00042 student code. */
export declare class ResetByCodeDto {
    code: string;
}
/**
 * App entry gate — resolve a login identifier (student code or email) to the
 * school host(s) it could belong to, before any tenant context exists.
 */
export declare class ResolveSchoolDto {
    identifier: string;
}
//# sourceMappingURL=dto.d.ts.map