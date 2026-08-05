import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const EMPLOYMENT = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY'] as const;
const KINDS = ['CHOICE', 'YES_NO', 'NUMBER', 'TEXT'] as const;

export class JobQuestionDto {
  @IsString() @Length(2, 160) prompt!: string;
  @IsIn(KINDS) kind!: (typeof KINDS)[number];
  /** CHOICE only; ignored for every other kind. */
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() required?: boolean;
}

export class CreateJobDto {
  @IsString() @Length(2, 160) title!: string;
  @IsString() @Length(2, 300) summary!: string;
  @IsString() @Length(2, 8000) description!: string;
  @IsOptional() @IsIn(EMPLOYMENT) employmentType?: (typeof EMPLOYMENT)[number];
  @IsOptional() @IsString() @Length(0, 120) subject?: string;
  /** How many people are needed. Not a boolean — schools hire in batches. */
  @IsOptional() @IsInt() @Min(1) @Max(99) posts?: number;
  @IsOptional() @IsInt() @Min(0) salaryMinMinor?: number;
  @IsOptional() @IsInt() @Min(0) salaryMaxMinor?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsDateString() applyBy?: string;
  /** The cap is also enforced in the service — a builder is skippable. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => JobQuestionDto)
  questions?: JobQuestionDto[];
}

export class UpdateJobDto extends CreateJobDto {
  @IsOptional() @IsString() @Length(2, 160) declare title: string;
  @IsOptional() @IsString() @Length(2, 300) declare summary: string;
  @IsOptional() @IsString() @Length(2, 8000) declare description: string;
}

export class ModerateJobDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  /** Required on REJECT — a refusal with no reason cannot be acted on. */
  @IsOptional() @IsString() @Length(2, 500) reason?: string;
}

/**
 * What a stranger may say about themselves.
 *
 * Deliberately absent: schoolId and jobPostId. Both come from the vacancy the
 * application was posted against, so nothing in this body can file a candidate
 * into a school it names.
 */
export class ApplyDto {
  @IsString() @Length(2, 120) name!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() @Length(4, 24) phone?: string;
  /** A LINK, not a file — there is no public upload endpoint in this product. */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @Length(4, 500) cvUrl!: string;
  @IsOptional() @IsObject() answers?: Record<string, string | number | boolean>;
}

export class SetApplicationStatusDto {
  @IsOptional() @IsIn(['NEW', 'SHORTLISTED', 'INTERVIEWING', 'REJECTED', 'HIRED']) status?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}
