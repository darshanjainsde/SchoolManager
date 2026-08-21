import type { Request, Response } from 'express';
import { OwnerAuthService } from './owner-auth.service';
import { GateLoginDto, OwnerLoginDto, RefreshDto } from './owner.dto';
export declare class OwnerAuthController {
    private readonly auth;
    private readonly env;
    constructor(auth: OwnerAuthService);
    login(dto: OwnerLoginDto, res: Response): Promise<import("./owner-auth.service").IssuedTokens>;
    gate(dto: GateLoginDto, res: Response): Promise<import("./owner-auth.service").IssuedTokens>;
    refresh(req: Request, dto: RefreshDto, res: Response): Promise<import("./owner-auth.service").IssuedTokens>;
}
//# sourceMappingURL=owner-auth.controller.d.ts.map