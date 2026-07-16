import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListMediaDto {
  @IsOptional()
  @IsIn(['LOGO', 'FAVICON', 'HERO', 'GALLERY', 'STAFF', 'PRINCIPAL', 'COURSE', 'HOF', 'ABOUT'])
  kind?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsHexColor() brandColorPrimary?: string;
  @IsOptional() @IsHexColor() brandColorSecondary?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 200) email?: string;
  @IsOptional() @IsString() @Length(0, 200) addressLine1?: string;
  @IsOptional() @IsString() @Length(0, 200) addressLine2?: string;
  @IsOptional() @IsString() @Length(0, 100) city?: string;
  @IsOptional() @IsString() @Length(0, 100) region?: string;
  @IsOptional() @IsString() @Length(0, 20) postalCode?: string;
  @IsOptional() @IsString() @Length(0, 100) country?: string;
  @IsOptional() @IsString() @Length(0, 500) mapEmbedUrl?: string;
  @IsOptional() @IsString() logoAssetId?: string;
  @IsOptional() @IsString() faviconAssetId?: string;
  @IsOptional() @IsIn(['INTER', 'FRAUNCES', 'POPPINS', 'NUNITO']) headingFont?: string;
  @IsOptional() @IsIn(['ILLUSTRATION', 'PHOTO', 'MINIMAL']) heroStyle?: string;
  @IsOptional() @IsIn(['FULL', 'SUBTLE', 'NONE']) animationLevel?: string;
  @IsOptional() @IsIn(['ACADEMIC', 'MODERN', 'PLAYFUL', 'ELEGANT', 'CUSTOM']) themePreset?: string;
  @IsOptional()
  @IsIn(['ILLUSTRATION', 'FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'COLLAGE', 'SLIDESHOW', 'MINIMAL'])
  heroLayout?: string;
  @IsOptional() @IsIn(['LEFT', 'CENTER']) heroTextAlign?: string;
  @IsOptional() @IsIn(['WASH', 'TINT', 'DARK']) heroOverlayStyle?: string;
  @IsOptional() @IsInt() @Min(10) @Max(95) heroOverlayOpacity?: number;
  @IsOptional() @IsIn(['FULL', 'COMPACT']) heroHeight?: string;
  @IsOptional() @IsIn(['DRAW', 'MARKER', 'GROW', 'NONE']) headlineAccent?: string;
  @IsOptional() @IsIn(['CLASSIC', 'CENTER', 'PILL', 'STRIP', 'GHOST']) navStyle?: string;
  @IsOptional() @IsString() @Length(1, 40) navCtaLabel?: string;
  @IsOptional() @IsBoolean() navShowCta?: boolean;
}

export class UpdateHomepageDto {
  @IsOptional() @IsString() @Length(0, 200) headline?: string;
  @IsOptional() @IsString() @Length(0, 400) subheadline?: string;
  @IsOptional() @IsString() @Length(0, 4000) aboutText?: string;
  @IsOptional() @IsString() @Length(0, 120) principalName?: string;
  @IsOptional() @IsString() @Length(0, 2000) principalMessage?: string;
  @IsOptional() @IsString() heroAssetId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) heroImageAssetIds?: string[];
  @IsOptional() @IsString() principalPhotoAssetId?: string;
  @IsOptional() @IsString() aboutImageAssetId?: string;
  @IsOptional() @IsBoolean() showAdmissions?: boolean;
  @IsOptional() @IsBoolean() showGallery?: boolean;
  @IsOptional() @IsBoolean() showEvents?: boolean;
  @IsOptional() @IsBoolean() showContact?: boolean;
}

export class StatItemDto {
  @IsString() @Length(1, 60) label!: string;
  @IsString() @Length(1, 60) value!: string;
  @IsInt() @Min(0) order!: number;
}
export class SetStatsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => StatItemDto) items!: StatItemDto[];
}

export class SocialLinkDto {
  @IsIn(['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'LINKEDIN']) platform!: string;
  @IsUrl() url!: string;
  @IsInt() @Min(0) order!: number;
}
export class SetSocialDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SocialLinkDto) links!: SocialLinkDto[];
}

export class UpsertStaffDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 120) role!: string;
  @IsOptional() @IsString() photoAssetId?: string;
  @IsInt() @Min(0) order!: number;
}

export class UpsertCourseDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(0, 200) tagline?: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 120, { each: true }) highlights?: string[];
  @IsOptional() @IsString() @Length(0, 60) ageRange?: string;
  @IsOptional() @IsString() imageAssetId?: string;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsInt() @Min(0) order!: number;
}

export class UpsertCourseFeeDto {
  @IsOptional() @IsString() @Length(0, 60) admissionFee?: string;
  @IsOptional() @IsString() @Length(0, 60) annualFee?: string;
  @IsOptional() @IsString() @Length(0, 200) includes?: string;
}

export class AdmissionStepDto {
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 400) description?: string;
  @IsInt() @Min(0) order!: number;
}
export class SetAdmissionStepsDto {
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AdmissionStepDto) steps!: AdmissionStepDto[];
}

export class UpdateAdmissionsSettingsDto {
  @IsOptional() @IsBoolean() showFeesPublicly?: boolean;
  @IsOptional() @IsString() @Length(0, 400) feeNote?: string;
}

export class HallOfFameEntryDto {
  @IsInt() @Min(1) @Max(3) rank!: number;
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(0, 120) achievement?: string;
  @IsOptional() @IsString() @Length(0, 20) year?: string;
  @IsOptional() @IsString() photoAssetId?: string;
}
export class SetHallOfFameDto {
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => HallOfFameEntryDto) entries!: HallOfFameEntryDto[];
}
