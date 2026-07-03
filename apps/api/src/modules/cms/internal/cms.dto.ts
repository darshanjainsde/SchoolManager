import { IsArray, IsHexColor, IsIn, IsOptional, IsString, IsUrl, Length, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
}

export class UpdateHomepageDto {
  @IsOptional() @IsString() @Length(0, 200) headline?: string;
  @IsOptional() @IsString() @Length(0, 400) subheadline?: string;
  @IsOptional() @IsString() @Length(0, 4000) aboutText?: string;
  @IsOptional() @IsString() @Length(0, 120) principalName?: string;
  @IsOptional() @IsString() @Length(0, 2000) principalMessage?: string;
  @IsOptional() @IsString() heroAssetId?: string;
  @IsOptional() @IsString() principalPhotoAssetId?: string;
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
