import {
  IsBoolean,
  IsObject,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * A query string carries only text: `?take=50` arrives as "50", and the global
 * ValidationPipe runs WITHOUT `enableImplicitConversion` — deliberately, since
 * implicit conversion would also coerce body fields and quietly turn a typo'd
 * "abc" into NaN. So every numeric or boolean QUERY field needs its own @Type.
 *
 * Without these the alumni roll 400s on its own first page load, and the
 * directory 400s the moment an alumnus filters by batch year. Both were live.
 */
const AsInt = () => Type(() => Number);
const AsBool = () =>
  Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));


/** The earliest batch a school could plausibly claim, and the latest. Bounds
 *  exist so a typo cannot create a Roll Call row for the year 20260. */
const MIN_BATCH_YEAR = 1900;
const MAX_BATCH_YEAR = 2100;

const GIFT_SCOPES = ['SCHOOL', 'GRADE', 'SECTION'] as const;
const GIFT_MODES = ['FUND', 'SUPPLY'] as const;
const DEDICATIONS = ['NONE', 'IN_MEMORY_OF', 'IN_HONOUR_OF'] as const;
const VISIBILITIES = ['PUBLIC', 'ALUMNI', 'ANONYMOUS'] as const;
const SESSION_MODES = ['IN_PERSON', 'ONLINE'] as const;

// ─── Alumni ──────────────────────────────────────────────────────────────────

export class ListAlumniQueryDto {
  @IsOptional() @IsString() @Length(1, 80) q?: string;
  @IsOptional() @AsInt() @IsInt() @Min(MIN_BATCH_YEAR) @Max(MAX_BATCH_YEAR) batchYear?: number;
  @IsOptional() @IsIn(['SCHOOL_ADDED', 'INVITED', 'PENDING', 'VERIFIED', 'DECLINED', 'HIDDEN'])
  status?: string;
  @IsOptional() @AsInt() @IsInt() @Min(1) @Max(200) take?: number;
  @IsOptional() @AsInt() @IsInt() @Min(0) skip?: number;
}

export class GraduateBatchDto {
  /** The class sections leaving this year. Explicit, because a school ending at
   *  X and one ending at XII graduate different children — and some children
   *  leave at X and go elsewhere, who are alumni too. */
  @IsUUID('4', { each: true }) classSectionIds!: string[];
  @IsInt() @Min(MIN_BATCH_YEAR) @Max(MAX_BATCH_YEAR) batchYear!: number;
}

export class SaveBatchStrengthDto {
  @IsInt() @Min(MIN_BATCH_YEAR) @Max(MAX_BATCH_YEAR) batchYear!: number;
  /** From the bound register. 0 means "not counted yet", which Roll Call shows
   *  as unknown rather than as 100%. */
  @IsInt() @Min(0) @Max(5000) registerStrength!: number;
  @IsOptional() @IsString() @Length(0, 400) note?: string;
}

export class DecideClaimDto {
  @IsIn(['VERIFY', 'DECLINE']) action!: 'VERIFY' | 'DECLINE';
  /** Required on DECLINE — the office owes a reason, same as a refused vacancy. */
  @IsOptional() @IsString() @Length(3, 400) reason?: string;
  /** Merge into a row that already exists rather than creating a second one.
   *  The duplicate is guaranteed: the same person gets imported AND self-registers. */
  @IsOptional() @IsUUID('4') mergeIntoAlumniId?: string;
}

export class SetTrustedDto {
  @IsBoolean() trusted!: boolean;
  @IsOptional() @IsString() @Length(3, 400) reason?: string;
}

// ─── Gifts ───────────────────────────────────────────────────────────────────

export class SaveGiftItemDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 40) unit?: string;
  /** Minor units — paise. Capped at ₹10,00,000 per unit: anything above that is
   *  a typo, and a typo here becomes a pledge somebody feels obliged to honour. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) indicativeCostMinor?: number;
  @IsOptional() @IsBoolean() sizesTracked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) order?: number;
}

export class CreatePledgeDto {
  @IsOptional() @IsUUID('4') alumniId?: string;
  /** For a parent or a local donor with no alumni record. */
  @IsOptional() @IsString() @Length(2, 120) donorName?: string;
  @IsOptional() @IsEmail() donorEmail?: string;

  @IsIn(GIFT_SCOPES) scopeKind!: (typeof GIFT_SCOPES)[number];
  @IsOptional() @IsUUID('4') gradeId?: string;
  @IsOptional() @IsUUID('4') classSectionId?: string;

  @IsOptional() @IsUUID('4') giftItemId?: string;
  /** Off-catalogue. Arrives as a proposal the office can counter, never as a
   *  pledge the school is stuck with. */
  @IsOptional() @IsString() @Length(3, 400) customRequest?: string;

  @IsIn(GIFT_MODES) mode!: (typeof GIFT_MODES)[number];

  /**
   * What the donor is willing to give PER CHILD, in paise.
   *
   * Overrides the school's indicative cost, because the list price is the
   * school's estimate of what a thing costs and this is what the donor is
   * actually offering — different facts. Ignored entirely for SUPPLY, where a
   * rupee valuation is never stored; a donor entering 0 there is telling us
   * they are sending the goods themselves, which is the sentence on the form.
   */
  @IsOptional() @AsInt() @IsInt() @Min(0) @Max(100_000_00) unitPriceMinor?: number;

  // ── Where to collect it, for a gift the donor is sending ──────────────────
  // Optional at pledge time: plenty of people offer first and work out the
  // logistics on the phone afterwards, and a required address is a form they
  // abandon. The office can fill these in later from its own screen.
  @IsOptional() @IsString() @Length(5, 400) pickupAddress?: string;
  @IsOptional() @IsString() @Length(2, 120) pickupContact?: string;
  @IsOptional() @IsString() @Length(4, 30) pickupPhone?: string;
  @IsOptional() @IsString() @Length(0, 400) pickupNote?: string;

  @IsOptional() @IsIn(DEDICATIONS) dedicationKind?: (typeof DEDICATIONS)[number];
  @IsOptional() @IsString() @Length(0, 240) dedicationText?: string;
  @IsOptional() @IsIn(VISIBILITIES) visibility?: (typeof VISIBILITIES)[number];
  @IsOptional() @IsISO8601() dueAt?: string;

  /** NOTE: there is deliberately no `quantity`. It is the headcount, resolved
   *  server-side from the live roster — a class of 38 with 20 sweaters is a
   *  worse place than one with none, so the donor does not get to choose. */
}

export class DecidePledgeDto {
  @IsIn(['ACCEPT', 'DECLINE', 'COUNTER', 'CANCEL']) action!: 'ACCEPT' | 'DECLINE' | 'COUNTER' | 'CANCEL';
  @IsOptional() @IsString() @Length(3, 400) reason?: string;
  /** COUNTER only: what the school would rather have. */
  @IsOptional() @IsString() @Length(3, 400) counterNote?: string;
}

/** Raised by either side; re-callable, because arrangements change. */
export class RequestPickupDto {
  @IsString() @Length(5, 400) pickupAddress!: string;
  @IsOptional() @IsString() @Length(2, 120) pickupContact?: string;
  @IsOptional() @IsString() @Length(4, 30) pickupPhone?: string;
  @IsOptional() @IsString() @Length(0, 400) pickupNote?: string;
}

/** Courier and reference are independent and both optional — plenty of gifts
 *  travel in somebody's car boot. The service refuses a reference with no
 *  carrier, because that is a number nobody can look up. */
export class MarkPickedUpDto {
  @IsOptional() @IsString() @Length(2, 80) courier?: string;
  @IsOptional() @IsString() @Length(2, 80) trackingRef?: string;
}

export class PurchaseGiftDto {
  @IsOptional() @IsString() @Length(0, 400) note?: string;
}

export class ThankYouDto {
  /** Long enough to be a sentence. A one-word thank you is worse than none. */
  @IsString() @Length(10, 2000) note!: string;
}

export class AttachGiftDto {
  @IsIn(['BILL', 'CONSIGNMENT', 'DISTRIBUTION']) kind!: 'BILL' | 'CONSIGNMENT' | 'DISTRIBUTION';
  @IsOptional() @IsString() @Length(0, 200) caption?: string;
}

export class ReceiveGiftDto {
  /** What ACTUALLY arrived. Pledged and received are two different numbers and
   *  both get written down — 38 promised, 36 delivered is a real, common event. */
  @IsInt() @Min(1) @Max(10_000) receivedQty!: number;
  @IsOptional() @IsString() @Length(0, 400) note?: string;
}

export class DistributeGiftDto {
  @IsInt() @Min(0) @Max(10_000) distributedQty!: number;
  /** The school already knows the 38 children, so "two absent" is a fact rather
   *  than an estimate somebody types. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000) absentQty?: number;
  @IsOptional() @IsString() @Length(0, 400) note?: string;
}

// ─── Guest sessions ──────────────────────────────────────────────────────────

export class SlotsQueryDto {
  @IsUUID('4') classSectionId!: string;
  /** Inclusive, YYYY-MM-DD. Capped to a fortnight server-side. */
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}

export class RequestSessionDto {
  @IsUUID('4') alumniId!: string;
  @IsString() @Length(4, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 1200) summary?: string;
  @IsOptional() @IsIn(SESSION_MODES) mode?: (typeof SESSION_MODES)[number];
  @IsUUID('4') classSectionId!: string;
  @IsISO8601() date!: string;
  @IsUUID('4') periodId!: string;
}

export class DecideSessionDto {
  @IsIn(['ACCEPT', 'COUNTER', 'DECLINE', 'CANCEL', 'DELIVER'])
  action!: 'ACCEPT' | 'COUNTER' | 'DECLINE' | 'CANCEL' | 'DELIVER';
  /** Required before anything can be SCHEDULED. The safeguarding rule as a
   *  field, not a paragraph. */
  @IsOptional() @IsUUID('4') accompanyingTeacherId?: string;
  @IsOptional() @IsISO8601() counterDate?: string;
  @IsOptional() @IsUUID('4') counterPeriodId?: string;
  @IsOptional() @IsString() @Length(3, 400) counterNote?: string;
  @IsOptional() @IsString() @Length(3, 400) reason?: string;
  @IsOptional() @IsUUID('4') roomId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2000) attendedCount?: number;
}

// ─── The alumnus's own door ──────────────────────────────────────────────────

export class RedeemClaimDto {
  /** The raw token from the link. In the BODY, never the query string: a token
   *  in a URL lands in server logs and in the Referer header of every outbound
   *  link on the page it opened. */
  @IsString() @Length(16, 512) token!: string;
}

export class DirectoryQueryDto {
  @IsOptional() @IsString() @Length(1, 80) q?: string;
  @IsOptional() @AsInt() @IsInt() @Min(MIN_BATCH_YEAR) @Max(MAX_BATCH_YEAR) batchYear?: number;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @AsBool() @IsBoolean() mentor?: boolean;
  @IsOptional() @AsInt() @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @AsInt() @IsInt() @Min(0) skip?: number;
}

/**
 * What an alumnus may change about themselves.
 *
 * Deliberately absent: `status`, `trustedForStudents`, `isBatchCaptain`,
 * `batchYear`, `admissionNo`. Those are the school's to grant or correct, and a
 * self-service field that could set them would make the whole verification
 * ladder decorative. `forbidNonWhitelisted` means sending one is a 400, not a
 * silent no-op.
 */
export class UpdateMeDto {
  @IsOptional() @IsString() @Length(0, 30) phone?: string;
  @IsOptional() @IsString() @Length(0, 80) city?: string;
  @IsOptional() @IsString() @Length(0, 80) country?: string;
  @IsOptional() @IsString() @Length(0, 120) profession?: string;
  @IsOptional() @IsString() @Length(0, 120) employer?: string;
  @IsOptional() @IsString() @Length(0, 120) collegeName?: string;
  @IsOptional() @IsBoolean() isMentor?: boolean;
  /** { field: PUBLIC | ALUMNI | BATCH | OFFICE | HIDDEN }. Unknown keys and
   *  unknown levels are read as HIDDEN by `privacyOf`, so a malformed blob
   *  closes a field rather than opening one. */
  @IsOptional() @IsObject() privacy?: Record<string, string>;
}

/**
 * "I was a student here" — the public front door to the verification queue.
 *
 * Five fields and no more. Every one of them is something a person genuinely
 * remembers about a school they left twenty years ago; anything else is a form
 * they abandon. There is deliberately no file upload — this product has no
 * public upload endpoint, and the pitch's answer was always a line of text a
 * clerk can check against the bound register.
 *
 * Nothing here can set a status. A claim is inert until a human in the office
 * matches it against the register, which is the entire point of the table.
 */
export class CreateClaimDto {
  @IsString() @Length(1, 60) firstName!: string;
  @IsString() @Length(1, 60) lastName!: string;
  @IsInt() @Min(MIN_BATCH_YEAR) @Max(MAX_BATCH_YEAR) batchYear!: number;
  /**
   * The one fact that lets the office check a claim by MACHINE. An alumnus
   * reliably remembers their own birthday twenty years on; the school holds it
   * on the student record. Optional only because a pre-Sckools school may have
   * nothing to compare it against — the form still asks for it.
   */
  @IsOptional() @IsISO8601() dob?: string;
  /** "10-B", "5th standard". Optional on purpose: the year is remembered and
   *  the section usually is not, and a required field somebody cannot answer is
   *  a form they abandon. */
  @IsOptional() @IsString() @Length(1, 40) claimedClass?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Length(4, 30) phone?: string;
  /** A parent's name, an admission number, a classmate. Free text, because the
   *  useful proof differs by decade and no dropdown covers it. */
  @IsString() @Length(3, 400) proof!: string;
}

/**
 * "I am already registered — send me my link."
 *
 * One field. The response is identical whether or not it matches anybody, so
 * this cannot be used to ask whether an address belongs to an alumnus of a
 * given school.
 */
export class RequestLinkDto {
  @IsString() @Length(4, 160) contact!: string;
}

/** The ordinary login, on the alumni page. */
export class AlumniLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(6, 200) password!: string;
}

/** The office gives a verified alumnus an account. Returns a temporary password
 *  ONCE, for the office to hand over — email does not work here yet. */
export class CreateAlumniAccountDto {
  @IsEmail() email!: string;
}

export class ChangeAlumniPasswordDto {
  @IsString() @Length(6, 200) currentPassword!: string;
  /** Eight is the floor a person will actually accept for an account they open
   *  three times a year. The link door remains for everybody else. */
  @IsString() @Length(8, 200) newPassword!: string;
}
