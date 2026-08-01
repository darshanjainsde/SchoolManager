import { IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Body for `POST /me/notifications/read`. Omit `ids` to mark EVERY unread
 * notification read (the "Mark all read" action); pass a specific set to mark
 * just those (e.g. the one the user tapped through). Only the caller's own rows
 * are ever touched — the service scopes by `userId`, never by these ids alone.
 */
export class MarkNotificationsReadDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}
