import { StorageService } from '../../../common/storage/storage.service';
declare const KINDS: readonly ["LOGO", "FAVICON", "HERO", "GALLERY", "STAFF", "PRINCIPAL"];
type Kind = (typeof KINDS)[number];
export declare class MediaService {
    private readonly storage;
    constructor(storage: StorageService);
    upload(schoolId: string, kind: Kind, file: {
        originalname: string;
        buffer: Buffer;
        mimetype: string;
    }): Promise<{
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
    list(schoolId: string, kind?: Kind): Promise<{
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
    remove(schoolId: string, id: string): Promise<{
        ok: boolean;
    }>;
}
export {};
//# sourceMappingURL=media.service.d.ts.map