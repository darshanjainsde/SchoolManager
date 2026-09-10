import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';

// ── Settings ──────────────────────────────────────────────

export class BandDto {
  @IsString() @Matches(/^[a-z0-9-]{1,20}$/) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) label!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true }) stds!: number[];
}

export class UpdateSportsSettingsDto {
  @IsOptional() @IsIn(['BANDS', 'AGE']) grouping?: 'BANDS' | 'AGE';
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => BandDto) bands?: BandDto[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsInt({ each: true }) @Min(0, { each: true }) @Max(100, { each: true }) pointsPlacing?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(100) pointsMatchWin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) pointsClassWin?: number;
  @IsOptional() @IsBoolean() publishNeedsAdmin?: boolean;
}

// ── Houses ────────────────────────────────────────────────

export class CreateHouseDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
}

export class UpdateHouseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) name?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) order?: number;
}

export class AssignHouseDto {
  /** null takes the students out of any house. */
  @ValidateIf((o) => o.houseId !== null) @IsUUID() houseId!: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @IsUUID('all', { each: true }) studentIds!: string[];
}

export class AwardPointsDto {
  @IsInt() @Min(-1000) @Max(1000) points!: number;
  @IsString() @IsNotEmpty() @MaxLength(120) reason!: string;
}

// ── Tournaments ───────────────────────────────────────────

export class VenueInDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
}

export class EventInDto {
  /** A catalogue key, or the word `custom` with `customName` + `presetKey`. */
  @IsString() @IsNotEmpty() @MaxLength(80) sportKey!: string;
  @IsOptional() @IsString() @MaxLength(40) customName?: string;
  @IsOptional() @IsString() @MaxLength(20) presetKey?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) teamSize?: number;
  @IsString() @IsNotEmpty() @MaxLength(20) groupKey!: string;
  @IsIn(['Boys', 'Girls', 'Mixed']) category!: 'Boys' | 'Girls' | 'Mixed';
  @IsIn(['CLASS', 'DRAW']) structure!: 'CLASS' | 'DRAW';
  /** Indexes into `venues`. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsInt({ each: true }) @Min(0, { each: true }) venueIdx!: number[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) studentIds!: string[];
  @IsOptional() @IsInt() @Min(5) @Max(240) slotMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(16) lanes?: number;
}

export class CreateTournamentDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1439) dayStartMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) dayEndMin?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => VenueInDto) venues!: VenueInDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => EventInDto) events!: EventInDto[];
}

export class MoveSlotDto {
  @IsOptional() @IsUUID() venueId?: string;
  @IsInt() @Min(0) @Max(1440 * 14) atMin!: number;
}

export class ShiftDto {
  @IsInt() @Min(-720) @Max(720) deltaMin!: number;
  @IsOptional() @IsUUID() eventId?: string;
  /** Only slots at or after this minute move (default: everything unplayed). */
  @IsOptional() @IsInt() @Min(0) fromMin?: number;
}

// ── Teachers (admin) ──────────────────────────────────────

export class SetCoachPermsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsIn(['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES', 'SETTINGS'], { each: true }) sportsPerms!: string[];
}
