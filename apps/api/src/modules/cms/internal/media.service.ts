import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { StorageService } from '../../../common/storage/storage.service';

const KINDS = ['LOGO', 'FAVICON', 'HERO', 'GALLERY', 'STAFF', 'PRINCIPAL'] as const;
type Kind = (typeof KINDS)[number];

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  async upload(
    schoolId: string,
    kind: Kind,
    file: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    const { key, url } = await this.storage.upload(
      `schools/${schoolId}/${kind.toLowerCase()}`,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    return withTenant(schoolId, (tx) =>
      tx.mediaAsset.create({
        data: {
          schoolId,
          kind,
          storageKey: key,
          url,
          byteSize: file.buffer.length,
        },
      }),
    );
  }

  async list(schoolId: string, kind?: Kind) {
    return withTenant(schoolId, (tx) =>
      tx.mediaAsset.findMany({
        where: { schoolId, ...(kind ? { kind } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async remove(schoolId: string, id: string) {
    const asset = await withTenant(schoolId, (tx) =>
      tx.mediaAsset.findUnique({ where: { id } }),
    );
    if (!asset || asset.schoolId !== schoolId) {
      throw new NotFoundException('Media not found');
    }
    await this.storage.delete(asset.storageKey);
    await withTenant(schoolId, (tx) => tx.mediaAsset.delete({ where: { id } }));
    return { ok: true };
  }
}
