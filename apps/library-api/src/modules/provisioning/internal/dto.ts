import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Note the validation is real, not decorative: this endpoint takes a
 * `schoolId` from a caller and creates an org keyed to it. A malformed id
 * would create an unreachable library that the readiness check would then
 * report as missing forever, with no obvious way to tell the two apart.
 */
export class ProvisionDto {
  /** Sckools `School.id`. The link between the two systems, and the idempotency key. */
  @IsUUID('4') schoolId!: string;

  /**
   * Reused from the school's own slug so the library is addressable by the
   * same name. Constrained to the same shape a hostname label allows, because
   * it is used as one.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'slug must be lowercase alphanumeric with internal hyphens',
  })
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) branchName?: string;
}
