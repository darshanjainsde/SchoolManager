import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
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

export class ListMediaDto {
  @IsOptional()
  // AVATAR is list-only (self-uploaded via POST /me/photo, never through the
  // site-media upload endpoint — see MediaController's KINDS) so admin tabs
  // can resolve person photoAssetIds to URLs.
  @IsIn(['LOGO', 'FAVICON', 'HERO', 'GALLERY', 'STAFF', 'PRINCIPAL', 'COURSE', 'HOF', 'ABOUT', 'AVATAR'])
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
  /** Statutory head for TCs: "CBSE, New Delhi" + affiliation number. */
  @IsOptional() @IsString() @Length(0, 80) board?: string;
  @IsOptional() @IsString() @Length(0, 40) affiliationNo?: string;
  @IsOptional() @IsString() logoAssetId?: string;
  @IsOptional() @IsString() faviconAssetId?: string;
  @IsOptional()
  @IsIn(['INTER', 'FRAUNCES', 'POPPINS', 'NUNITO', 'PLAYFAIR', 'LORA', 'MONTSERRAT', 'SPACE_GROTESK'])
  headingFont?: string;
  @IsOptional() @IsIn(['ILLUSTRATION', 'PHOTO', 'MINIMAL']) heroStyle?: string;
  @IsOptional() @IsIn(['LIVELY', 'FULL', 'BALANCED', 'SUBTLE', 'MINIMAL', 'NONE']) animationLevel?: string;
  @IsOptional() @IsIn(['ACADEMIC', 'MODERN', 'PLAYFUL', 'ELEGANT', 'CUSTOM']) themePreset?: string;
  @IsOptional()
  @IsIn(['ILLUSTRATION', 'FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'COLLAGE', 'SLIDESHOW', 'MINIMAL'])
  heroLayout?: string;
  @IsOptional() @IsIn(['LEFT', 'CENTER']) heroTextAlign?: string;
  @IsOptional() @IsIn(['WASH', 'TINT', 'DARK']) heroOverlayStyle?: string;
  @IsOptional() @IsInt() @Min(10) @Max(95) heroOverlayOpacity?: number;
  @IsOptional() @IsIn(['FULL', 'COMPACT']) heroHeight?: string;
  @IsOptional() @IsIn(['DRAW', 'MARKER', 'GROW', 'NONE']) headlineAccent?: string;
  /** How every band below the fold is drawn. See SECTION_SHAPES on the web. */
  @IsOptional() @IsIn(['LINK', 'OUTLINE', 'SOLID']) navLoginStyle?: string;
  @IsOptional() @IsIn(['SOFT', 'EDITORIAL', 'CRISP', 'PANELS', 'SLANT', 'NOTCH', 'WAVE']) sectionShape?: string;
  /** WHAT a section does as it arrives; animationLevel stays the volume. */
  @IsOptional() @IsIn(['RISE', 'FADE', 'DRAW', 'SLIDE', 'ZOOM', 'CURTAIN', 'FLIP']) motionGesture?: string;
  @IsOptional() @IsIn(['NONE', 'GRID', 'DOTS', 'PAPER']) backgroundTexture?: string;
  /**
   * The school's menu arrangement. Shape is validated on the WEB side by
   * validateNavConfig before it is ever sent — the rules there (six controls,
   * no empty group, no nesting, no lost page) are product rules with messages
   * an admin reads, not field constraints.
   */
  @IsOptional() @IsObject() navConfig?: Record<string, unknown>;
  @IsOptional() @IsIn(['CLASSIC', 'CENTER', 'PILL', 'STRIP', 'GHOST']) navStyle?: string;
  @IsOptional() @IsIn(['PAPER', 'WHITE', 'DARK', 'BRAND']) navColor?: string;
  @IsOptional() @IsIn(['AUTO', 'LIGHT', 'DARK']) navTextColor?: string;
  @IsOptional() @IsString() @Length(1, 40) navCtaLabel?: string;
  @IsOptional() @IsBoolean() navShowCta?: boolean;
  @IsOptional() @IsString() @Length(1, 40) navLoginLabel?: string;
  @IsOptional() @IsBoolean() navShowLogin?: boolean;
  /** ── Website-studio axes. Vocabulary mirrors apps/web site-variants.ts. ── */
  @IsOptional() @IsIn(['CLASSIC', 'GLIDE', 'SNAP', 'DECK', 'HORIZONTAL', 'ZOOM', 'REVEAL', 'TILT']) scrollFeel?: string;
  @IsOptional() @IsIn(['FADE', 'SLIDE', 'SCALE']) navDropdownAnim?: string;
  @IsOptional() @IsIn(['IMAGE', 'VIDEO']) heroMedia?: string;
  /** Direct mp4/webm URL; empty string clears it. */
  @IsOptional() @IsString() @Length(0, 800) heroVideoUrl?: string;
  /** Shapes validated on the WEB side (normalizeSectionVariants et al.), same
   *  contract as navConfig — product rules with admin-readable messages. */
  @IsOptional() @IsObject() sectionVariants?: Record<string, unknown>;
  @IsOptional() @IsObject() festiveTheme?: Record<string, unknown>;
  @IsOptional() @IsObject() footerConfig?: Record<string, unknown>;
  /** Sanitized server-side on write (custom-code.ts), scoped on render. */
  @IsOptional() @IsObject() customSectionCss?: Record<string, unknown>;
  @IsOptional() @IsString() @Length(0, 20000) customHtmlBlock?: string;
}

/* ── Design drafts (saved looks; window = read-time overlay) ── */
export class UpsertDesignDraftDto {
  @IsString() @Length(1, 80) name!: string;
  /** The design subset of the profile; whitelisted in the service. */
  @IsObject() config!: Record<string, unknown>;
  /** ISO datetimes; null clears. Window semantics live in the service. */
  @IsOptional() @IsString() publishAt?: string | null;
  @IsOptional() @IsString() revertAt?: string | null;
}

/* ── Admin-built pages ── */
export class UpsertSchoolPageDto {
  @IsString() @Length(1, 120) title!: string;
  /** Frozen at creation; ignored on update. */
  @IsOptional() @IsString() @Length(1, 80) slug?: string;
  @IsArray() @ArrayMaxSize(40) blocks!: unknown[];
  @IsOptional() @IsBoolean() published?: boolean;
  /** false = reachable only from the footer, not the navbar. Default true. */
  @IsOptional() @IsBoolean() showInNav?: boolean;
  @IsOptional() @IsInt() @Min(0) order?: number;
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
