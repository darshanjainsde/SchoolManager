import { ArrayMaxSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/** How many schools one event may be hand-addressed to. */
export const MAX_SELECTED_SCHOOLS = 50;

export class CreateEventDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
  @IsIn(['SCHOOL', 'NETWORK']) scope!: 'SCHOOL' | 'NETWORK';
  /**
   * Who sees this event.
   *
   * EVERYWHERE is deliberately absent: it is the legacy "every school on the
   * platform" behaviour that made one public-site response 3.16 MB, and it
   * cannot be chosen for a NEW event. Existing rows keep it until they pass.
   */
  @IsOptional() @IsIn(['SCHOOL_ONLY', 'CITY', 'SELECTED'])
  audienceKind?: 'SCHOOL_ONLY' | 'CITY' | 'SELECTED';
  /** Required when audienceKind = SELECTED. Ignored otherwise. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SELECTED_SCHOOLS) @IsUUID('4', { each: true })
  audienceSchoolIds?: string[];
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

  // ── What the public page needs to offer a place ──────────────────────────
  /** The ticket a public join registers against. Null = nothing to join. */
  ticketTypeId: string | null;
  /** null = uncapped. 0 is a real value: sold out by configuration. */
  capacity: number | null;
  /**
   * null means UNKNOWN, not unlimited — either the event is uncapped, or it
   * belongs to another school whose registrations RLS correctly hides from us.
   */
  seatsLeft: number | null;
  /** Whether the public Join button should be offered at all. */
  registrationOpen: boolean;
  priceMinor: number;
  currency: string;
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

/**
 * What a visitor on the public site may say about themselves — and nothing
 * more. There is deliberately no `studentId` and no `fromSchoolId` here: the
 * admin `RegisterDto` has them because an authenticated office is trusted to
 * name a pupil, and a stranger on the internet is not. Adding either field to
 * this class is how that distinction would be lost.
 */
export class PublicRegisterDto {
  @IsString() @Length(2, 120) guestName!: string;
  @IsEmail() guestEmail!: string;
  @IsOptional() @IsString() @Length(4, 24) guestPhone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) quantity?: number;
}

export class SetRegistrationStatusDto {
  @IsIn(['CONFIRMED', 'DECLINED', 'CANCELLED'])
  status!: 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
}
