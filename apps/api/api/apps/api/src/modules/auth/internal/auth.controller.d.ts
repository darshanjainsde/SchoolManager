import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto, ImpersonateDto, LoginDto, RefreshDto, ResetByCodeDto, ResetPasswordDto, ResolveSchoolDto } from './dto';
import { SchoolResolveService } from './school-resolve.service';
import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
export declare class AuthController {
    private readonly auth;
    private readonly passwordReset;
    private readonly tenantCtx;
    private readonly features;
    private readonly schoolResolve;
    private readonly env;
    constructor(auth: AuthService, passwordReset: PasswordResetService, tenantCtx: TenantContextService, features: FeatureResolverService, schoolResolve: SchoolResolveService);
    /**
     * App entry gate — the identifier field's replacement for the deleted
     * "enter your school code" screen. Deliberately does NOT touch tenant
     * context: it runs before the app knows which school it is talking to.
     * Same neutral shape whether or not the identifier exists (an empty list),
     * throttled like login.
     */
    resolveSchool(dto: ResolveSchoolDto): Promise<{
        hosts: string[];
    }>;
    login(dto: LoginDto, res: Response): Promise<import("./auth.service").IssuedTokens>;
    refresh(req: Request, dto: RefreshDto, res: Response): Promise<import("./auth.service").IssuedTokens>;
    forgotPassword(dto: ForgotPasswordDto): Promise<{
        ok: boolean;
    }>;
    /**
     * Phase 5·1 — reset with only the student code. Tighter throttle than
     * forgot-password: the response carries a masked email (the confirmation
     * the parent sees), so brute-forcing codes must stay expensive.
     */
    resetByCode(dto: ResetByCodeDto): Promise<{
        ok: boolean;
        emailMasked: string | null;
    }>;
    resetPassword(dto: ResetPasswordDto): Promise<{
        ok: boolean;
    }>;
    impersonate(dto: ImpersonateDto): Promise<{
        accessToken: string;
        expiresIn: number;
        impersonated: true;
    }>;
    logout(req: Request, dto: RefreshDto, user: SchoolJwtPayload, res: Response): Promise<{
        ok: boolean;
    }>;
    me(user: SchoolJwtPayload): Promise<{
        userId: string;
        schoolId: string;
        role: import("@skoolos/db").$Enums.UserRole;
        name: string | null;
        features: import("@skoolos/db").FeatureKey[];
    }>;
}
//# sourceMappingURL=auth.controller.d.ts.map