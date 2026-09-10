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

// ── Teachers (admin) ──────────────────────────────────────

export class SetCoachPermsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsIn(['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES', 'SETTINGS'], { each: true }) sportsPerms!: string[];
}
