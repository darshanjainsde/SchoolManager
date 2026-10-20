import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { MESSAGE_BODY_MAX, MESSAGE_REPORT_REASON_MAX } from '@skoolos/types';

/** Student starts/continues a thread — `POST /me/messages`. The teacher/subject
 * pair is re-validated against the student's timetable in the service; these
 * checks only guarantee well-formed input. */
export class StudentSendMessageDto {
  @IsUUID()
  teacherId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @Length(1, MESSAGE_BODY_MAX)
  body!: string;
}

/** Teacher replies within an existing thread — `POST /manage/messages/:threadId`. */
export class TeacherReplyDto {
  @IsString()
  @Length(1, MESSAGE_BODY_MAX)
  body!: string;
}

/** Report a thread (or one message in it) to the school —
 * `POST /manage/messages/:threadId/report` and `POST /me/messages/:threadId/report`.
 * `messageId`, when given, must be a message IN that thread (checked in the service). */
export class ReportMessageDto {
  @IsString()
  @Length(1, MESSAGE_REPORT_REASON_MAX)
  reason!: string;

  @IsOptional()
  @IsUUID()
  messageId?: string;
}

/** Block (true) or unblock (false) a thread for the caller's own side —
 * `POST /manage/messages/:threadId/block` and `POST /me/messages/:threadId/block`. */
export class BlockThreadDto {
  @IsBoolean()
  blocked!: boolean;
}
