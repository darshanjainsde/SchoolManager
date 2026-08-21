import { AdminCredentialsService } from './admin-credentials.service';
export declare class AdminCredentialsController {
    private readonly svc;
    constructor(svc: AdminCredentialsService);
    listAdmins(id: string): Promise<import("./admin-credentials.service").AdminRow[]>;
    resetPassword(id: string, userId: string): Promise<{
        password: string;
    }>;
}
//# sourceMappingURL=admin-credentials.controller.d.ts.map