import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { AvatarUploadResponse } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/storage/storage.service';
import { TenantContextService } from '../tenancy';

/**
 * Avatars are photos, not documents — 2MB is generous for a face and keeps the
 * bucket honest (assignments allow 4MB for worksheets; this is deliberately
 * half that).
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

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
@Injectable()
export class PhotoService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly storage: StorageService,
  ) {}

  async setOwn(userId: string, role: string, file: UploadedAvatar | undefined): Promise<AvatarUploadResponse> {
    if (!file || !file.buffer) {
      throw new ApiError('FILE_REQUIRED', 'Attach an image as "file"', 400);
    }
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      throw new ApiError('UNSUPPORTED_TYPE', 'Profile photos must be images', 415);
    }
    if (file.buffer.length > MAX_AVATAR_BYTES) {
      throw new ApiError('FILE_TOO_LARGE', 'Keep photos under 2MB', 413);
    }

    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      // Resolve the caller's own person row — the only row this endpoint may touch.
      let personId: string | null = null;
      if (role === 'STUDENT') {
        const s = await tx.student.findFirst({ where: { userId }, select: { id: true } });
        personId = s?.id ?? null;
      } else if (role === 'TEACHER') {
        const t = await tx.teacher.findFirst({ where: { userId }, select: { id: true } });
        personId = t?.id ?? null;
      } else if (role === 'STAFF') {
        const st = await tx.staff.findFirst({ where: { userId }, select: { id: true } });
        personId = st?.id ?? null;
      }
      if (!personId) {
        throw new ApiError('NO_PROFILE', 'This login has no personal profile to attach a photo to', 404);
      }

      const { key, url } = await this.storage.upload(
        `schools/${schoolId}/avatar`,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
      const asset = await tx.mediaAsset.create({
        data: { schoolId, kind: 'AVATAR', storageKey: key, url, byteSize: file.buffer.length },
      });

      if (role === 'STUDENT') {
        await tx.student.update({ where: { id: personId }, data: { photoAssetId: asset.id } });
      } else if (role === 'TEACHER') {
        await tx.teacher.update({ where: { id: personId }, data: { photoAssetId: asset.id } });
      } else {
        await tx.staff.update({ where: { id: personId }, data: { photoAssetId: asset.id } });
      }

      return { assetId: asset.id, photoUrl: url };
    });
  }
}
