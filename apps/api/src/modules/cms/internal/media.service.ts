import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { StorageService } from '../../../common/storage/storage.service';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

const KINDS = ['LOGO', 'FAVICON', 'HERO', 'GALLERY', 'STAFF', 'PRINCIPAL'] as const;
type Kind = (typeof KINDS)[number];

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly storage: StorageService) {}

  async upload(
    schoolId: string,
    kind: Kind,
    file: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    // Storage and the DB row are separate failure domains, and until now both
    // collapsed into one opaque 500 ("Something went wrong"). Split them so the
    // admin sees which step failed and the real cause is captured in the logs
    // (console.* is what the serverless log pipeline actually keeps).
    let stored: { key: string; url: string };
    try {
      stored = await this.storage.upload(
        `schools/${schoolId}/${kind.toLowerCase()}`,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
    } catch (err) {
      const e = err as {
        name?: string;
        message?: string;
        Code?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const status = e?.$metadata?.httpStatusCode;
      // eslint-disable-next-line no-console
      console.error('[media.upload] storage failed', {
        schoolId,
        kind,
        name: e?.name,
        code: e?.Code ?? e?.code,
        httpStatus: status,
        message: e?.message,
      });
      this.logger.error(`storage.upload failed for ${schoolId}/${kind}: ${e?.name} ${e?.message}`);
      // Prefer the HTTP status (e.g. "HTTP 410" = endpoint gone/misconfigured);
      // fall back to the error code/name.
      const detail = status ? `HTTP ${status}` : (e?.Code ?? e?.code ?? e?.name ?? 'error');
      throw new ServiceUnavailableException(`Image storage failed (${detail})`);
    }

    try {
      return await withTenant(schoolId, (tx) =>
        tx.mediaAsset.create({
          data: {
            schoolId,
            kind,
            storageKey: stored.key,
            url: stored.url,
            byteSize: file.buffer.length,
          },
        }),
      );
    } catch (err) {
      const e = err as { name?: string; message?: string; code?: string };
      // eslint-disable-next-line no-console
      console.error('[media.upload] db create failed', { schoolId, kind, name: e?.name, code: e?.code, message: e?.message });
      this.logger.error(`mediaAsset.create failed for ${schoolId}/${kind}: ${e?.code ?? e?.name} ${e?.message}`);
      // The object is already in storage; drop it so a retry doesn't orphan it.
      await this.storage.delete(stored.key);
      throw new InternalServerErrorException(`Saving the image record failed (${e?.code ?? e?.name ?? 'error'})`);
    }
  }

  async list(schoolId: string, kind?: Kind) {
    return withTenant(schoolId, (tx) =>
      tx.mediaAsset.findMany({ take: LIST_CEILING.ACTIVITY,
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
