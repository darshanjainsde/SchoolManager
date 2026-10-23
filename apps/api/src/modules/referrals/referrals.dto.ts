import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { EXPECT_KEYS, INT_MAX } from './referral-rules';

/** Loose on purpose: "+91 98765 43210", "9876543210", "098765-43210" all pass; the key is normalised later. */
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

// ─── Promoter: sign in / sign up ───────────────────────────────────────────

export class StartCodeDto {
  @IsIn(['email', 'whatsapp']) channel!: 'email' | 'whatsapp';
  @ValidateIf((o) => o.channel === 'email') @lower() @IsEmail({}, { message: 'That does not look like an email address.' }) email?: string;
  @ValidateIf((o) => o.channel === 'whatsapp') @trim() @Matches(PHONE_RE, { message: 'That does not look like a phone number.' }) phone?: string;
}

export class VerifyCodeDto {
  @IsUUID() challengeId!: string;
  @trim() @Matches(/^\d{6}$/, { message: 'The code is six digits.' }) code!: string;
  /** Needed only the first time an address is seen (sign-up). */
  @IsOptional() @trim() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @trim() @IsString() @Length(1, 80) city?: string;
}

/** Profile and questionnaire. Everything optional on the wire; the service decides what "complete" means. */
export class UpdatePromoterDto {
  @IsOptional() @trim() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @trim() @IsString() @Length(0, 80) city?: string;
  @IsOptional() @trim() @IsString() @Length(0, 60) who?: string;
  @IsOptional() @IsIn(EXPECT_KEYS as readonly string[]) expect?: string;
  @IsOptional() @trim() @IsString() @Length(0, 200) areas?: string;
  @IsOptional() @trim() @IsString() @Length(0, 1000) know?: string;
  @IsOptional() @trim() @IsString() @Length(0, 400) schoolsInMind?: string;
  @IsOptional() @IsBoolean() hasGst?: boolean;
}

export class CreateReferralDto {
  @trim() @IsString() @Length(2, 120, { message: 'The school name is needed.' }) schoolName!: string;
  @trim() @IsString() @Length(2, 80, { message: 'The city is needed.' }) city!: string;
  @IsOptional() @trim() @IsString() @Length(0, 80) area?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50000) studentsApprox?: number;
  @IsOptional() @trim() @IsString() @Length(0, 40) board?: string;
  @trim() @IsString() @Length(2, 80, { message: 'The contact person is needed.' }) contactName!: string;
  @IsOptional() @trim() @IsString() @Length(0, 40) contactRole?: string;
  @trim() @Matches(PHONE_RE, { message: 'A phone number for the contact is needed.' }) contactPhone!: string;
  @IsOptional() @lower() @IsEmail() contactEmail?: string;
  @IsOptional() @trim() @IsString() @Length(0, 20) planInterest?: string;
  @IsOptional() @trim() @IsString() @Length(0, 1000) howKnown?: string;
  /** The one line that cannot be skipped: we only call people who expect it. */
  @IsBoolean() @Equals(true, { message: 'Tick that the contact agrees to a call from Sckools.' }) consent!: boolean;
}

export class ReferralNoteDto {
  @trim() @IsString() @Length(1, 1000) body!: string;
}

export class PayoutDetailsDto {
  @trim() @IsString() @Length(2, 80) payeeName!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN is ten characters, like ABCDE1234F.' }) pan!: string;
  @IsOptional() @trim() @Matches(/^\d{9,18}$/, { message: 'Bank account is 9 to 18 digits.' }) bankAccount?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'IFSC is eleven characters, like HDFC0001234.' }) ifsc?: string;
  @IsOptional() @lower() @Matches(/^[\w.-]{2,}@[a-z]{2,}$/, { message: 'A UPI id looks like name@bank.' }) upi?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'GSTIN is fifteen characters.' }) gstin?: string;
  @IsOptional() @trim() @IsString() @Length(0, 300) address?: string;
}

// ─── Owner ─────────────────────────────────────────────────────────────────

export class SetCommissionDto {
  @IsInt() @Min(1) @Max(50) pct!: number;
  /** Paise. 0 means no cap; omitted means the platform's default cap. */
  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) capMinor?: number | null;
  @IsOptional() @trim() @IsString() @Length(0, 300) note?: string;
}

export class SetPromoterStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'REMOVED']) status!: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  @ValidateIf((o) => o.status !== 'ACTIVE') @trim() @IsString() @Length(3, 300, { message: 'Say why; the promoter sees this.' }) reason?: string;
}

export class AddPromoterDto {
  @trim() @IsString() @Length(2, 80) name!: string;
  @IsOptional() @lower() @IsEmail() email?: string;
  @IsOptional() @trim() @Matches(PHONE_RE) phone?: string;
  @IsOptional() @trim() @IsString() @Length(0, 80) city?: string;
}

export class RejectReferralDto {
  @trim() @IsString() @Length(3, 300, { message: 'Say why; the promoter sees this.' }) reason!: string;
}

export class ReferralStageDto {
  @IsIn(['ACCEPTED', 'CONTACTED', 'DEMO_DONE', 'PROPOSAL_SENT', 'WON', 'LIVE', 'LOST']) status!: 'ACCEPTED' | 'CONTACTED' | 'DEMO_DONE' | 'PROPOSAL_SENT' | 'WON' | 'LIVE' | 'LOST';
  /** The school's first-year invoice in paise; required when the stage is LIVE. */
  @ValidateIf((o) => o.status === 'LIVE') @IsInt() @Min(1) @Max(INT_MAX) invoiceMinor?: number;
  @IsOptional() @trim() @IsString() @Length(0, 300) reason?: string;
  @IsOptional() @IsUUID() wonSchoolId?: string;
}

export class MarkPaidDto {
  @trim() @IsString() @Length(4, 40) utr!: string;
  @IsOptional() @IsString() paidOn?: string;
}

export class ReferralSettingsDto {
  @IsOptional() ladder?: Record<string, number>;
  @IsOptional() @IsInt() @Min(0) @Max(INT_MAX) capMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) payoutDays?: number;
  @IsOptional() @IsInt() @Min(7) @Max(730) attributionDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) tdsPct?: number;
}
