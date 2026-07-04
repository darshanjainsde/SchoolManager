import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateEventDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
  @IsIn(['SCHOOL', 'NETWORK']) scope!: 'SCHOOL' | 'NETWORK';
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
