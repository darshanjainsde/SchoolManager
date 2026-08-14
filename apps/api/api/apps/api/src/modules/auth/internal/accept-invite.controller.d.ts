import { TenantContextService } from '../../tenancy';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';
export declare class AcceptInviteDto {
    userId: string;
    inviteToken: string;
    password: string;
    email?: string;
}
/**
 * Phase 2 finish-line. Lives on the *tenant* host because the invite URL the
 * provisioning email sends looks like:
 *   https://<slug>.skoolos.app/accept-invite?token=…&u=…
 *
 * Mechanism — schema-additive, no extra column needed:
 *   OnboardingService stores the placeholder password hash as `argon2(inviteToken)`.
 *   That makes "did the user already accept?" equivalent to "does
 *   argon2.verify(placeholderHash, suppliedToken)" — once they set a real
 *   password the hash is replaced and the verify returns false.
 *
 * Cross-tenant safety:
 *   We trust ctx.schoolId from the tenant middleware (resolved from Host).
 *   If a user row with the supplied id belongs to a different school we
 *   return 404 — never reveal existence. Cross-tenant exploitation requires
 *   the attacker to control DNS for *that* tenant's host, which is gated
 *   by the platform's domain-verification flow.
 *
 * Rate limit: 10 req / minute (per-IP) — combined with 192-bit token entropy
 * this is unbreakable in practice.
 */
export declare class AcceptInviteController {
    private readonly tenantCtx;
    private readonly passwords;
    private readonly auth;
    private readonly logger;
    constructor(tenantCtx: TenantContextService, passwords: PasswordService, auth: AuthService);
    accept(dto: AcceptInviteDto): Promise<import("./auth.service").IssuedTokens>;
}
//# sourceMappingURL=accept-invite.controller.d.ts.map