import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './management.dto';
/**
 * Assignments (T21). File attachments upload through THIS module's own
 * `POST /manage/assignments/upload`, deliberately NOT `POST /site/media`
 * (`MediaController`, `apps/api/src/modules/cms/internal/media.controller.ts`):
 *
 *  - `MediaService`/`MediaAsset` are scoped to a fixed site-content `kind`
 *    enum (LOGO/FAVICON/HERO/GALLERY/STAFF/…) — an assignment attachment has
 *    no honest fit in that taxonomy.
 *  - `MediaController.upload` rejects anything that isn't `image/*` — a
 *    teacher attaching a scanned worksheet as a PDF would 400 unconditionally.
 *  - `MediaController` carries NO `@Roles` guard at all (only
 *    `SchoolJwtGuard`) — any authenticated school login, any role, may call
 *    it today. An assignments upload needs a TEACHER-usable path with the
 *    SAME ownership story as the rest of this module.
 *
 * So: a THIN endpoint here that delegates to the SAME underlying
 * `StorageService` (S3/MinIO locally, Supabase Storage in prod) `MediaService`
 * itself wraps — no new storage machinery, just a different, correctly-scoped
 * front door onto it. See `AssignmentsService.upload`.
 *
 * Vercel serverless functions cap a request body at roughly 4.5MB —
 * `MAX_ATTACHMENT_BYTES` (4MB) stays under that with headroom for multipart
 * framing. The web/mobile UI enforces the SAME cap client-side (so an
 * oversized file is rejected before ever leaving the device), and this
 * multer limit plus `AssignmentsService.upload`'s own check enforce it again
 * server-side — never trust the client alone.
 */
export declare class AssignmentsController {
    private readonly assignments;
    private readonly tenant;
    constructor(assignments: AssignmentsService, tenant: TenantContextService);
    private sid;
    upload(file: Express.Multer.File): Promise<import("@skoolos/types").AssignmentAttachment>;
    create(dto: CreateAssignmentDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").Assignment>;
    list(classSectionId: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").AssignmentList>;
    remove(id: string, u: SchoolJwtPayload): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=assignments.controller.d.ts.map