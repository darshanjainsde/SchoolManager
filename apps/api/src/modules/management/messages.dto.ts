import { IsString, IsUUID, Length } from 'class-validator';
import { MESSAGE_BODY_MAX } from '@skoolos/types';

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
