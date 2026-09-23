import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class UpsertComponentDto {
  @IsString() @Matches(/^[a-z0-9_]{1,30}$/) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsIn(['EARNING', 'DEDUCTION', 'EMPLOYER_COST']) kind!: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST';
  @IsIn(['FIXED', 'PCT_OF_BASIC', 'PCT_OF_GROSS', 'BALANCE']) calc!: 'FIXED' | 'PCT_OF_BASIC' | 'PCT_OF_GROSS' | 'BALANCE';
  @IsOptional() @IsInt() @Min(0) @Max(10_000) rateBps?: number;
  @IsOptional() @IsBoolean() taxable?: boolean;
  @IsOptional() @IsBoolean() isWages?: boolean;
  @IsOptional() @IsBoolean() retirementBase?: boolean;
  @IsOptional() @IsBoolean() healthBase?: boolean;
  @IsOptional() @IsBoolean() gratuityBase?: boolean;
  @IsOptional() @IsBoolean() prorate?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) order?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(200) hint?: string;
}

export class SetStructureDto {
  @IsIn(['TEACHER', 'STAFF']) personKind!: 'TEACHER' | 'STAFF';
  @IsUUID() personId!: string;
  @Matches(DATE) effectiveFrom!: string;
  /** Paise. A crore a month is a typo, not a salary. */
  @IsInt() @Min(0) @Max(1_000_000_00) monthlyGrossMinor!: number;
  @IsOptional() @IsObject() fixedAmounts?: Record<string, number>;
  /** The job this pay belongs to. Everything else on this DTO has a default. */
  @IsOptional() @IsUUID() payGradeId?: string;
  @IsOptional() @IsIn(['NEW', 'OLD']) taxRegime?: 'NEW' | 'OLD';
  @IsOptional() @IsBoolean() pfOptIn?: boolean;
  @IsOptional() @IsBoolean() pfOnActual?: boolean;
  @IsOptional() @IsBoolean() esiExempt?: boolean;
  @IsOptional() @IsBoolean() localTaxExempt?: boolean;
  @IsOptional() @IsBoolean() paidThroughVacation?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(12) contractMonths?: number;
  @IsOptional() @IsBoolean() fixedTerm?: boolean;
  @IsOptional() @Matches(DATE) joinedOn?: string;
  @IsOptional() @IsString() @MaxLength(10) pan?: string;
  @IsOptional() @IsString() @MaxLength(12) uan?: string;
  @IsOptional() @IsString() @MaxLength(20) esiNumber?: string;
  @IsOptional() @IsString() @MaxLength(30) bankAccount?: string;
  @IsOptional() @IsString() @MaxLength(11) bankIfsc?: string;
  @IsOptional() @IsString() @MaxLength(60) bankName?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /** The Code on Wages 50% rule is warn-then-accept, not a wall: the school may record that it is taking the risk. */
  @IsOptional() @IsBoolean() acceptWageShare?: boolean;
}

export class PreviewStructureDto {
  @IsInt() @Min(0) @Max(1_000_000_00) monthlyGrossMinor!: number;
  @IsOptional() @IsObject() fixedAmounts?: Record<string, number>;
  @IsOptional() @IsUUID() payGradeId?: string;
  @IsOptional() @Matches(DATE) onISO?: string;
}

export class OpenRunDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}

export class AdjustmentDto {
  @IsIn(['TEACHER', 'STAFF']) personKind!: 'TEACHER' | 'STAFF';
  @IsUUID() personId!: string;
  @IsInt() @Min(2000) @Max(2100) periodYear!: number;
  @IsInt() @Min(1) @Max(12) periodMonth!: number;
  @IsString() @IsNotEmpty() @MaxLength(80) label!: string;
  @IsIn(['EARNING', 'DEDUCTION']) kind!: 'EARNING' | 'DEDUCTION';
  @IsInt() @Min(-10_000_000) @Max(10_000_000) amountMinor!: number;
  @IsOptional() @IsBoolean() taxable?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(31) lopDays?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class GrantSalaryDto {
  @IsUUID() userId!: string;
  @IsBoolean() canSeeSalary!: boolean;
}

export class SchoolPayCountryDto {
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsOptional() @IsString() @MaxLength(8) region?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
}

export class SaveDeclarationDto {
  @IsInt() @Min(2000) @Max(2100) taxYear!: number;
  @IsOptional() @IsIn(['NEW', 'OLD']) regime?: 'NEW' | 'OLD';
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) rentAnnualMinor?: number;
  @IsOptional() @IsBoolean() metro?: boolean;
  @IsOptional() @IsString() @MaxLength(10) landlordPan?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) section80cMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) section80dMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) homeLoanInterestMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) otherIncomeMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) previousEmployerSalaryMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) previousEmployerTdsMinor?: number;
  @IsOptional() @IsBoolean() submit?: boolean;
}

export class BulkStructureDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SetStructureDto) rows!: SetStructureDto[];
}

/** One component, as a grade wants it: a percentage retuned or a figure fixed. */
export class GradeOverrideDto {
  @IsOptional() @IsInt() @Min(0) @Max(10_000) rateBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_00) fixedMinor?: number;
}

export class UpsertGradeDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(40) name!: string;
  @IsOptional() @IsString() @MaxLength(80) description?: string;
  /** Paise. Zero means "no band set yet", which is legal — a band is guidance. */
  @IsInt() @Min(0) @Max(1_000_000_00) bandMinMinor!: number;
  @IsInt() @Min(0) @Max(1_000_000_00) bandMaxMinor!: number;
  @IsOptional() @IsObject() overrides?: Record<string, { rateBps?: number; fixedMinor?: number }>;
  @IsOptional() @IsInt() @Min(0) @Max(999) order?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class RaiseGradeDto {
  @IsUUID() gradeId!: string;
  @Matches(DATE) effectiveFrom!: string;
  /** 500 = 5%. One of these two; a raise needs a size. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000) percentBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_00) flatMinor?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsBoolean() acceptWageShare?: boolean;
}

export class AssignPersonDto {
  @IsIn(['TEACHER', 'STAFF']) personKind!: 'TEACHER' | 'STAFF';
  @IsUUID() personId!: string;
  @IsInt() @Min(0) @Max(1_000_000_00) monthlyGrossMinor!: number;
}

export class AssignGradeDto {
  @IsUUID() gradeId!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AssignPersonDto) rows!: AssignPersonDto[];
}

export class PreviewGradeDto {
  @IsObject() overrides!: Record<string, { rateBps?: number; fixedMinor?: number }>;
  @IsInt() @Min(0) @Max(1_000_000_00) monthlyGrossMinor!: number;
  @IsOptional() @Matches(DATE) onISO?: string;
}
