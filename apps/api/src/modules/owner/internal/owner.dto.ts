import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class OwnerLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
  // MFA is optional: verified only when a code is supplied.
  @IsOptional() @Matches(/^\d{6}$/) totp?: string;
}

export class RefreshDto {
  /** Optional: the token normally arrives as an HttpOnly cookie. The body form
   *  is kept so sessions created before the cookie shipped can still refresh. */
  @IsOptional() @IsString() refreshToken?: string;
}

export class GateLoginDto {
  @IsString() @Length(1, 200) password!: string;
}

export class CreateSchoolDto {
  @IsString() @Length(2, 120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) slug!: string;
  @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO';
  @IsString() @Matches(/^[a-z0-9.-]+$/) domainHostname!: string;
  @IsEmail() adminEmail!: string;
}

export class SetTierDto {
  @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO';
}

export class SetStatusDto {
  @IsIn(['SETUP', 'LIVE', 'SUSPENDED']) status!: 'SETUP' | 'LIVE' | 'SUSPENDED';
}

/**
 * The THIRD copy of the feature-key list, after packages/db/src/features.ts
 * (the source of truth) and the owner console's own. All three drifted apart
 * and the drift was silent: HIRING and LIBRARY existed as real keys that
 * nothing could set. The console was fixed first, and the checkbox then failed
 * against THIS list — a validation error is at least loud, unlike the missing
 * checkbox that preceded it.
 *
 * `apps/web/app/platform/schools/[id]/feature-keys.test.ts` now parses all
 * three and fails if any disagrees. Keep this list in step with `ALL_KEYS`.
 *
 * LIBRARY belongs to no tier by design, so this route is the ONLY way it is
 * ever switched on. Omitting it here makes the whole library feature
 * unreachable no matter what the UI offers.
 */
export class SetFeatureDto {
  @IsIn(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS', 'MANAGEMENT', 'BLOG', 'HIRING', 'LIBRARY'])
  featureKey!: string;
  @IsBoolean() enabled!: boolean;
}

export class ModerateEventDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
}

export class OwnerCreateEventDto {
  @IsUUID() schoolId!: string;
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
}

/**
 * The owner's decision on a vacancy. Declared HERE, not imported from the
 * hiring module: a DTO belongs to the module whose controller consumes it, and
 * the boundary rule forbids reaching into another module's internals.
 */
export class ModerateJobDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  /** Required on REJECT — a refusal with no reason cannot be acted on. */
  @IsOptional() @IsString() @Length(2, 500) reason?: string;
}

export class AddDomainDto {
  /** Lower-cased and trimmed server-side; uniqueness is global. */
  @IsString() @Length(3, 253) @Matches(/^[A-Za-z0-9.-]+$/) hostname!: string;
}
