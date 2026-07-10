import { IsIn, IsInt, IsEmail, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

/** Digits with optional +, spaces, dashes, parens — 7..16 significant chars. */
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsString()
  @Matches(PHONE_RE, { message: 'phone must be a valid phone number' })
  phone!: string;

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

export class SetLeadStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'CLOSED'])
  status!: 'NEW' | 'CONTACTED' | 'CLOSED';
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
