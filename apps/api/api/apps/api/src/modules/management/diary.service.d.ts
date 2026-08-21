import type { DiaryEntryRow, DiaryPageResult, DiarySignResult, StudentDiaryResult } from '@skoolos/types';
import { NotificationService } from '../../common/notifications/notification.service';
import type { CreateDiaryEntryDto, UpdateDiaryEntryDto } from './management.dto';
/**
 * The Daily Diary — the paper diary a child carries home, made digital.
 *
 * A teacher writes ITEMs (homework, "bring your art file") and REMARKs (the
 * red-ink note a parent signs) against one (class, date) page. Either kind
 * addresses the whole section (`audience: ALL`, no per-student rows) or a
 * typed-in shortlist (`audience: SELECTED`, one `DiaryRecipient` per child).
 *
 * Two rules carry the feature and are enforced HERE, not in any client:
 *
 *   1. A REMARK always reaches the parent by email, the moment it is written
 *      — a child signing it in the app does not, and cannot, replace that.
 *      The signature is an acknowledgement, not a substitute for telling the
 *      family (`create`'s post-commit fan-out).
 *   2. Today's page is ink that is still wet; a past page is read-only. Edits
 *      and deletes are refused once the day has turned (`assertToday`), so a
 *      diary a parent has already read cannot be quietly rewritten.
 *
 * Deliberately separate from `ClassNotesService`: those notes are a teachers'
 * handover log for a (class, date, subject) and are never shown to a family.
 * A diary entry exists to be read at home.
 */
export declare class DiaryService {
    private readonly notifications;
    private readonly logger;
    constructor(notifications: NotificationService);
    private assertDate;
    /**
     * Today's page is editable; a past one is closed ink. SCHOOL_ADMIN is NOT
     * exempted — unlike reopening a register (an admin's call to grant), a diary
     * line is the teacher's own words to a family, and rewriting yesterday's
     * after a parent has read it is exactly what this rule exists to prevent.
     */
    private assertToday;
    /** Teacher display names for a set of Teacher.ids, in one query. */
    private teacherNames;
    /**
     * One class's diary page for one day, as the TEACHER sees it — every entry
     * with its named children and its read/signature receipts.
     */
    page(schoolId: string, classSectionId: string, date: string, userId: string, role: string): Promise<DiaryPageResult>;
    /**
     * Writes one diary line. A REMARK must name at least one child (there is no
     * such thing as a remark about everybody), and every named child must
     * actually be on this section's roster — the same enrolment check the
     * register does, for the same reason: knowing a studentId must not be
     * enough to write into another class's diary.
     */
    create(schoolId: string, userId: string, role: string, dto: CreateDiaryEntryDto): Promise<DiaryEntryRow>;
    /**
     * The linked-login `User.id`s a diary entry is addressed to: the named
     * students for a SELECTED entry, the whole section for an ALL one. Students
     * without a login simply produce no recipient, never an error — the same
     * rule the push/email resolvers follow.
     */
    private recipientUserIds;
    /**
     * Rule 1, post-commit: the parent is told, in full, by email — always, and
     * regardless of whether the child ever opens the app. Best-effort like every
     * other notify() call site: a mail failure is logged, never surfaced to the
     * teacher who wrote the remark.
     */
    private emailRemark;
    /** Corrects today's wording. Author-only: a diary line is someone's own words. */
    update(schoolId: string, userId: string, role: string, id: string, dto: UpdateDiaryEntryDto): Promise<DiaryEntryRow>;
    /** Strikes today's line out entirely. Author-only, today-only. */
    remove(schoolId: string, userId: string, role: string, id: string): Promise<void>;
    /**
     * The shared gate for both mutations: the entry exists, it is still today's
     * ink, and the caller wrote it. A SCHOOL_ADMIN is not given a bypass here —
     * see `assertToday`; if a remark truly must go, the author strikes it out.
     */
    private requireOwnEntry;
    /**
     * The child's own diary. `date` narrows to one page; without it, the last
     * `STUDENT_WINDOW_DAYS` days, newest first — the "flip back through the
     * week" view.
     *
     * Reading marks the page seen: a `DiaryAck` row is created for every entry
     * rendered (idempotent via `one_ack_per_entry_student`), which is what feeds
     * the teacher's "23 of 28 families have opened this" receipt.
     */
    studentDiary(schoolId: string, userId: string, date?: string): Promise<StudentDiaryResult>;
    /**
     * The signature in the margin. Idempotent by design — re-signing keeps the
     * FIRST signature's timestamp and name, so a second tap can never overwrite
     * the record of who acknowledged the remark and when.
     */
    sign(schoolId: string, userId: string, id: string, signedName: string): Promise<DiarySignResult>;
}
//# sourceMappingURL=diary.service.d.ts.map