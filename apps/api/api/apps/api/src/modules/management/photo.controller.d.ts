import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PhotoService } from './photo.service';
/**
 * `POST /me/photo` — set YOUR OWN profile photo (Phase 5·0d). Role-agnostic
 * across the three person-bearing roles; the service resolves the person row
 * from the JWT, so no id is ever accepted. Multipart field name `file`,
 * image/* only, 2MB cap (both here at the interceptor and re-checked in the
 * service, mirroring `AssignmentsController`'s upload).
 */
export declare class PhotoController {
    private readonly photo;
    constructor(photo: PhotoService);
    upload(u: SchoolJwtPayload, file: {
        originalname: string;
        buffer: Buffer;
        mimetype: string;
    } | undefined): Promise<import("@skoolos/types").AvatarUploadResponse>;
}
//# sourceMappingURL=photo.controller.d.ts.map