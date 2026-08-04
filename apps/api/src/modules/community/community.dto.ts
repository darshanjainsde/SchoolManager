import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateEventDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
  @IsIn(['SCHOOL', 'NETWORK']) scope!: 'SCHOOL' | 'NETWORK';
  /** Seats available. Omitted means unlimited — no number is invented. */
  @IsOptional() @IsInt() @Min(0) capacity?: number;
}

export class UpdateEventDto {
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
}

export interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startAt: string;
  endAt: string | null;
  venue: string | null;
  scope: 'SCHOOL' | 'NETWORK';
  originSchoolName: string | null; // null when it's the host school's own event
  isHost: boolean;                 // true when this event belongs to the viewing school
}

/**
 * Registering somebody for an event.
 *
 * Either a signed-in student or a guest — the database enforces that at least
 * one identifies the row, because a registration nobody can be told about is
 * worse than a rejected one.
 */
export class RegisterDto {
  @IsOptional() @IsUUID() ticketTypeId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) quantity?: number;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() fromSchoolId?: string;
  @IsOptional() @IsString() @Length(1, 120) guestName?: string;
  @IsOptional() @IsEmail() guestEmail?: string;
  @IsOptional() @IsString() @Length(4, 24) guestPhone?: string;
}

export class SetRegistrationStatusDto {
  @IsIn(['CONFIRMED', 'DECLINED', 'CANCELLED'])
  status!: 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
}
