import { AssignmentAttachmentKind, AttendanceStatusValue, ClassNoteVisibilityValue, DiaryAudience, DiaryEntryKind, HolidayType } from '@skoolos/types';
export declare class CreateYearDto {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
}
export declare class CreateGradeDto {
    name: string;
    order: number;
}
export declare class UpdateGradeDto {
    name?: string;
    order?: number;
}
export declare class CreateSubjectDto {
    name: string;
    code: string;
}
export declare class UpdateSubjectDto {
    name?: string;
    code?: string;
}
export declare class CreatePeriodDto {
    order: number;
    label: string;
    startTime: string;
    endTime: string;
    /** Defaults to CLASS at the DB layer; a BREAK period is how lunch/recess is modeled. */
    kind?: 'CLASS' | 'BREAK';
}
export declare class UpdatePeriodDto {
    order?: number;
    label?: string;
    startTime?: string;
    endTime?: string;
    kind?: 'CLASS' | 'BREAK';
}
export declare class UpdateWorkingDaysDto {
    workingDays: number[];
}
export declare class CreateTeacherDto {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    photoAssetId?: string;
    primarySubjectId?: string;
    bio?: string;
    isActive?: boolean;
}
export declare class UpdateTeacherDto {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    photoAssetId?: string;
    primarySubjectId?: string;
    bio?: string;
    isActive?: boolean;
}
declare const STAFF_ROLES: readonly ["OFFICE", "SUPPORT", "DRIVER", "HELPER", "SECURITY", "OTHER"];
export type StaffRoleValue = (typeof STAFF_ROLES)[number];
export declare class CreateStaffDto {
    firstName: string;
    lastName: string;
    role: StaffRoleValue;
    email?: string;
    phone?: string;
    isActive?: boolean;
}
export declare class UpdateStaffDto {
    firstName?: string;
    lastName?: string;
    role?: StaffRoleValue;
    email?: string;
    phone?: string;
    isActive?: boolean;
}
export declare class CreateClassDto {
    gradeId: string;
    name: string;
    academicYearId: string;
    classTeacherId?: string;
}
export declare class UpdateClassDto {
    gradeId?: string;
    name?: string;
    academicYearId?: string;
    classTeacherId?: string;
}
export declare class CreateStudentDto {
    admissionNo: string;
    firstName: string;
    lastName: string;
    classSectionId?: string;
    rollNo?: string;
    dob?: string;
    gender?: string;
    guardianName?: string;
    guardianPhone?: string;
    photoAssetId?: string;
}
export declare class UpdateStudentDto {
    admissionNo?: string;
    firstName?: string;
    lastName?: string;
    classSectionId?: string;
    rollNo?: string;
    dob?: string;
    gender?: string;
    guardianName?: string;
    guardianPhone?: string;
    photoAssetId?: string;
    isActive?: boolean;
}
/**
 * `email` is intentionally optional here (not `@IsEmail() email!: string`):
 * the "required" business rule differs per caller (always required for
 * students; falls back to the existing Teacher.email for teachers) and the
 * service throws a typed `EMAIL_REQUIRED` ApiError rather than a generic
 * class-validator 400, so the check has to happen after this DTO parses.
 */
export declare class CreateLoginDto {
    email?: string;
    username?: string;
}
export declare class AssignSlotDto {
    classSectionId: string;
    dayOfWeek: number;
    periodId: string;
    subjectId: string;
    teacherId: string;
    academicYearId: string;
}
export declare class AvailabilityQueryDto {
    academicYearId?: string;
}
export declare class CreateAnnouncementDto {
    title: string;
    body: string;
    /**
     * Legacy single-target field — still accepted so the existing web admin
     * "post to one class" flow keeps working unchanged. Omitted (together with
     * `classSectionIds`) = school-wide.
     */
    classSectionId?: string;
    /**
     * Multi-target field (teacher-authored announcements to several classes at
     * once). Merged with `classSectionId` by the service, not overridden by
     * it — a caller may send either or both.
     */
    classSectionIds?: string[];
}
export declare class UpdateAnnouncementDto {
    title?: string;
    body?: string;
    classSectionId?: string;
}
export declare class AttendanceMarkDto {
    studentId: string;
    status: AttendanceStatusValue;
}
export declare class SaveAttendanceDto {
    classSectionId: string;
    date: string;
    marks: AttendanceMarkDto[];
}
export declare class StaffAttendanceMarkDto {
    personId: string;
    kind: 'TEACHER' | 'STAFF';
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';
}
export declare class SaveStaffAttendanceDto {
    date: string;
    marks: StaffAttendanceMarkDto[];
}
export declare class CreateExamDto {
    classSectionId: string;
    subjectId: string;
    title: string;
    scheduledAt: string;
    syllabus?: string;
    maxMarks: number;
}
export declare class ExamResultMarkDto {
    studentId: string;
    marks: number;
}
export declare class SaveExamResultsDto {
    marks: ExamResultMarkDto[];
}
declare const LEAVE_TYPES: readonly ["SICK", "CASUAL", "EARNED", "UNPAID", "OTHER"];
export type LeaveTypeValue = (typeof LEAVE_TYPES)[number];
export declare class CreateLeaveDto {
    type: LeaveTypeValue;
    startDate: string;
    endDate: string;
    reason?: string;
}
export declare class AssignSubstitutionDto {
    substituteTeacherId: string;
}
export declare class CreateHolidayDto {
    name: string;
    type: HolidayType;
    startDate: string;
    endDate?: string;
}
export declare class CreateClassNoteDto {
    classSectionId: string;
    subjectId: string;
    date: string;
    body: string;
}
export declare class CreateClassTodoDto extends CreateClassNoteDto {
}
export declare class UpdateClassTodoDto {
    done: boolean;
}
export declare class UpdateClassNoteVisibilityDto {
    classNoteVisibility: ClassNoteVisibilityValue;
}
export declare class CreateRegisterChangeDto {
    classSectionId: string;
    date: string;
    reason: string;
}
/**
 * One entry of `CreateAssignmentDto.attachments` — the exact shape
 * `POST /manage/assignments/upload` returns, round-tripped straight back
 * on create. `url` is `require_tld: false` so a local MinIO dev URL
 * (`http://localhost:9000/...`) validates the same as a production Supabase
 * Storage URL — this DTO validates SHAPE, not provenance; the value always
 * comes from our own upload endpoint's response, never typed by a caller.
 */
export declare class AssignmentAttachmentDto {
    url: string;
    name: string;
    kind: AssignmentAttachmentKind;
}
export declare class CreateAssignmentDto {
    classSectionId: string;
    subjectId: string;
    title: string;
    instructions: string;
    dueDate: string;
    /**
     * Optional — an assignment with plain-text instructions and no file is
     * legitimate. Capped at 5: enough for "the worksheet + an answer key
     * scan", not an open-ended file dump.
     */
    attachments?: AssignmentAttachmentDto[];
}
export declare class CreateDiaryEntryDto {
    classSectionId: string;
    date: string;
    kind: DiaryEntryKind;
    /** Ignored for a REMARK, which is always SELECTED — see DiaryService.create. */
    audience?: DiaryAudience;
    body: string;
    subjectId?: string;
    /** The children named by the type-a-name picker. Capped well above any real
     *  class so a whole section can still be named one by one if a teacher wants. */
    studentIds?: string[];
}
export declare class UpdateDiaryEntryDto {
    body: string;
}
export declare class NotifyLowAttendanceDto {
    classSectionId: string;
    threshold: number;
    from: string;
    to: string;
    /** The teacher's final say: exactly which families to tell. Omitted means
     *  every student under the threshold in the window. */
    studentIds?: string[];
}
export {};
//# sourceMappingURL=management.dto.d.ts.map