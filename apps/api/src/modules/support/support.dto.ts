import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { SUPPORT_MODULES, SUPPORT_SEVERITIES, SUPPORT_STATUSES, SUPPORT_TICKET_TYPES } from '@skoolos/types';

/**
 * A multipart form sends every field as a STRING, so a checkbox arrives as
 * "true"/"false" (or not at all). Read it as a boolean before validating it
 * as one; JSON bodies pass real booleans straight through.
 */
const toBool = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true' || value === '1' || value === 'on') return true;
    if (value === false || value === 'false' || value === '0' || value === 'off') return false;
    return value;
  });

export class CreateTicketDto {
  @IsIn([...SUPPORT_TICKET_TYPES]) type!: (typeof SUPPORT_TICKET_TYPES)[number];
  @IsIn([...SUPPORT_MODULES]) module!: (typeof SUPPORT_MODULES)[number];
  @IsIn([...SUPPORT_SEVERITIES]) severity!: (typeof SUPPORT_SEVERITIES)[number];
  @IsString() @MinLength(3) @MaxLength(120) title!: string;
  @IsString() @MinLength(3) @MaxLength(4000) body!: string;
  /** The console route the Report button was pressed on. */
  @IsOptional() @IsString() @MaxLength(200) pagePath?: string;
  @IsOptional() @IsString() @MaxLength(40) appVersion?: string;
  /** "Allow Sckools to open our console to investigate, for 48 hours." */
  @IsOptional() @toBool() @IsBoolean() allowLookIn?: boolean;
}

export class SchoolCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class ReopenDto {
  @IsString() @MinLength(3) @MaxLength(4000) body!: string;
}

export class LookInDto {
  @toBool() @IsBoolean() allow!: boolean;
}

export class OwnerCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  /** False = a private note the school never sees. */
  @IsOptional() @toBool() @IsBoolean() visibleToSchool?: boolean;
}

export class OwnerStatusDto {
  @IsIn([...SUPPORT_STATUSES]) status!: (typeof SUPPORT_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
}

export class AssignDto {
  @toBool() @IsBoolean() assign!: boolean;
}

export class PatchTicketDto {
  /** The owner's own reference (a GitHub issue). Null clears it. */
  @ValidateIf((o) => o.externalRef !== null) @IsString() @MaxLength(120) externalRef!: string | null;
}
