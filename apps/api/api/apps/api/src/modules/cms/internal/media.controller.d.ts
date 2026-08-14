import { TenantContextService } from '../../tenancy';
import { MediaService } from './media.service';
import { ListMediaDto } from './cms.dto';
export declare class MediaController {
    private readonly media;
    private readonly tenant;
    constructor(media: MediaService, tenant: TenantContextService);
    private sid;
    upload(file: Express.Multer.File, kind: string): Promise<{
        kind: import("@skoolos/db").$Enums.MediaKind;
        id: string;
        createdAt: Date;
        schoolId: string;
        url: string;
        order: number;
        storageKey: string;
        caption: string | null;
        width: number | null;
        height: number | null;
        byteSize: number | null;
    }>;
    list(q: ListMediaDto): Promise<{
        kind: import("@skoolos/db").$Enums.MediaKind;
        id: string;
        createdAt: Date;
        schoolId: string;
        url: string;
        order: number;
        storageKey: string;
        caption: string | null;
        width: number | null;
        height: number | null;
        byteSize: number | null;
    }[]>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=media.controller.d.ts.map