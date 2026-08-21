import { type Announcement, type UserRole } from '@skoolos/db';
import type { AnnouncementMine } from '@skoolos/types';
import { NotificationService } from '../../common/notifications/notification.service';
import { AttendanceService } from './attendance.service';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';
export declare class AnnouncementsService {
    private readonly notifications;
    private readonly attendance;
    private readonly logger;
    constructor(notifications: NotificationService, attendance: AttendanceService);
    list(schoolId: string): Promise<({
        classSection: {
            name: string;
        } | null;
    } & {
        body: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        classSectionId: string | null;
        createdByUserId: string | null;
    })[]>;
    /**
     * The caller's OWN posted rows, newest first — `GET
     * /manage/announcements/mine` (`TEACHER` only; `SCHOOL_ADMIN` already has
     * the unfiltered `list()` above and has no need of this one).
     *
     * One `AnnouncementMine` per stored row (see the type's doc comment in
     * `@skoolos/types` for why this is NOT grouped by title/body/createdAt
     * into a plural `classSectionIds` shape) — each entry maps 1:1 to the
     * `PATCH`/`DELETE /manage/announcements/:id` the teacher client calls to
     * edit/delete it.
     */
    mine(schoolId: string, userId: string): Promise<AnnouncementMine[]>;
    /**
     * Creates one `Announcement` row per targeted class section, or a single
     * whole-school row (`classSectionId: null`) when nothing is targeted.
     *
     * `dto.classSectionId` (legacy singular, still posted by the web admin UI)
     * and `dto.classSectionIds` (new, multi-target) are merged — a caller may
     * send either or both.
     *
     * A TEACHER caller may only target sections from their own
     * `AttendanceService.myClassSections(schoolId, userId, role)` list — the
     * SAME ownership query `attendance.service.ts` already uses for the
     * take/view-attendance scope, reused here via constructor injection
     * (both services already live in `ManagementModule`) rather than
     * re-implemented. A TEACHER who targets nothing, or targets a section they
     * do not own, is rejected with a 403 `CLASS_NOT_OWNED` before any write.
     * SCHOOL_ADMIN is exempt from the ownership check and may omit/empty the
     * target list for a whole-school announcement (the pre-existing
     * `classSectionId: null` behavior).
     *
     * Push/email fan-out (`ANNOUNCEMENT`) runs best-effort, in the background
     * (`runInBackground`) after the write transaction commits, so the caller's
     * response is never blocked on notification delivery. For a class-targeted
     * announcement it resolves recipients per targeted section — via the same
     * `resolveSectionRecipients` helper `AttendanceService.save`'s
     * ABSENCE_NOTICE fan-out uses — so each recipient's payload carries THEIR
     * class's name. For a whole-school announcement it resolves EVERY
     * linked-user student in the school via `resolveSchoolRecipients` (the
     * school-wide counterpart, no classSectionId filter) and every recipient
     * gets `className: null`.
     */
    create(schoolId: string, createdByUserId: string, role: UserRole, dto: CreateAnnouncementDto): Promise<Announcement[]>;
    /**
     * `caller` is required so a TEACHER's edit can be checked against the row
     * they actually authored — resolved from the STORED row's
     * `createdByUserId` below, never from anything the client sends.
     * `SCHOOL_ADMIN` keeps today's unrestricted access (both to any
     * announcement AND to retargeting `classSectionId`).
     *
     * A TEACHER may edit title/body only — class targets are immutable once
     * posted (v1 decision: retargeting is a delete-and-repost, not an edit,
     * so the ownership/CLASS_NOT_OWNED check `create()` runs never has to be
     * re-run here). A TEACHER supplying `classSectionId` at all — even
     * unchanged — is rejected, since only `SCHOOL_ADMIN` payloads are
     * expected to carry that field.
     */
    update(schoolId: string, id: string, dto: UpdateAnnouncementDto, caller: {
        userId: string;
        role: UserRole;
    }): Promise<{
        body: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        classSectionId: string | null;
        createdByUserId: string | null;
    }>;
    /** Same authorship rule as `update` — resolved from the stored row, never client input. */
    remove(schoolId: string, id: string, caller: {
        userId: string;
        role: UserRole;
    }): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=announcements.service.d.ts.map