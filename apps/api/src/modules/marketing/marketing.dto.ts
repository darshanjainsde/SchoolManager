import { IsIn, IsInt, IsEmail, IsISO8601, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

/** Digits with optional +, spaces, dashes, parens — 7..16 significant chars. */
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

/**
 * The pipeline, in order, plus the legacy CLOSED.
 *
 * CLOSED is still accepted because the console deployed before this change
 * sends it on every status change; rejecting it would turn this release into a
 * breaking one for a client we have not replaced yet. Nothing new writes it —
 * `PIPELINE_STAGES` is what the current console offers.
 */
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO', 'WON', 'LOST', 'CLOSED'] as const;

/** The stages a lead can be moved TO. CLOSED is deliberately absent. */
export const PIPELINE_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO', 'WON', 'LOST'] as const;
export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const LEAD_ACTIVITY_KINDS = ['NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING'] as const;
export type LeadActivityKindValue = (typeof LEAD_ACTIVITY_KINDS)[number];

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsString()
  @Matches(PHONE_RE, { message: 'phone must be a valid phone number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  school?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  interest?: string;

  @IsString()
  @Length(1, 80)
  source!: string;
}

/**
 * Partial update of a lead from the owner console. Every field is optional so
 * the console can PATCH just the stage, just the follow-up date, or a
 * corrected phone number, without round-tripping the whole row.
 *
 * `nextFollowUpAt: null` clears the follow-up — distinct from omitting it,
 * which leaves it untouched.
 */
export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatusValue;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_RE, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  school?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  interest?: string;

  // `null` is an explicit "clear it", so the ISO check only applies to strings.
  @IsOptional()
  @IsISO8601()
  nextFollowUpAt?: string | null;
}

export class CreateLeadActivityDto {
  @IsIn(LEAD_ACTIVITY_KINDS)
  kind!: LeadActivityKindValue;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;
}

/** Kept for the legacy status-only PATCH the console used before the pipeline. */
export class SetLeadStatusDto {
  @IsIn(LEAD_STATUSES)
  status!: LeadStatusValue;
}

export class UpdateMarketingConfigDto {
  @IsInt() @Min(0) priceBasicUsd!: number;
  @IsInt() @Min(0) priceBasicInr!: number;
  @IsInt() @Min(0) priceStdUsd!: number;
  @IsInt() @Min(0) priceStdInr!: number;
  @IsInt() @Min(0) priceProUsd!: number;
  @IsInt() @Min(0) priceProInr!: number;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  contactPhone?: string;
}

export interface PublicMarketingConfig {
  prices: {
    basic: { usd: number; inr: number };
    standard: { usd: number; inr: number };
    pro: { usd: number; inr: number };
  };
  contactEmail: string;
  contactPhone: string;
}
