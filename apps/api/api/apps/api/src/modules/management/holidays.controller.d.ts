import { TenantContextService } from '../tenancy';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './management.dto';
export declare class HolidaysController {
    private readonly svc;
    private readonly tenant;
    constructor(svc: HolidaysService, tenant: TenantContextService);
    private sid;
    list(): Promise<import("@skoolos/types").Holiday[]>;
    create(dto: CreateHolidayDto): Promise<import("@skoolos/types").Holiday>;
    remove(id: string): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=holidays.controller.d.ts.map