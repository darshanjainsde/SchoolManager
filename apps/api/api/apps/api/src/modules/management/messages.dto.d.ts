/** Student starts/continues a thread — `POST /me/messages`. The teacher/subject
 * pair is re-validated against the student's timetable in the service; these
 * checks only guarantee well-formed input. */
export declare class StudentSendMessageDto {
    teacherId: string;
    subjectId: string;
    body: string;
}
/** Teacher replies within an existing thread — `POST /manage/messages/:threadId`. */
export declare class TeacherReplyDto {
    body: string;
}
//# sourceMappingURL=messages.dto.d.ts.map