import type { AvatarUploadResponse } from '@skoolos/types';
import { StorageService } from '../../common/storage/storage.service';
import { TenantContextService } from '../tenancy';
/**
 * Avatars are photos, not documents — 2MB is generous for a face and keeps the
 * bucket honest (assignments allow 4MB for worksheets; this is deliberately
 * half that).
 */
export declare const MAX_AVATAR_BYTES: number;
interface UploadedAvatar {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
}
/**
 * Self-service profile photo (Phase 5·0d — "paste a photo in the diary").
 *
 * THE RULE: a caller may only ever set THEIR OWN photo. The person row is
 * resolved from the JWT's `sub` + `role` — never from a client-supplied id —
 * exactly the `/me/*` self-scoping spine. The stored shape reuses the
 * established avatar pipeline verbatim (upload → `MediaAsset` row → set the
 * person's `photoAssetId`), which is what the admin Teachers tab already
 * renders — so a photo set here appears everywhere `photoAssetId` is read,
 * with no new read paths.
 *
 * Old assets are left in place on replacement, matching the admin teacher-photo
 * flow (assets are cheap; a delete-on-replace can silently break anything else
 * holding the old asset id).
 */
export declare class PhotoService {
    private readonly tenant;
    private readonly storage;
    constructor(tenant: TenantContextService, storage: StorageService);
    setOwn(userId: string, role: string, file: UploadedAvatar | undefined): Promise<AvatarUploadResponse>;
}
export {};
//# sourceMappingURL=photo.service.d.ts.map