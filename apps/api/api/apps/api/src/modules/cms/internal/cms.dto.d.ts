export declare class ListMediaDto {
    kind?: string;
}
export declare class UpdateProfileDto {
    brandColorPrimary?: string;
    brandColorSecondary?: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    mapEmbedUrl?: string;
    logoAssetId?: string;
    faviconAssetId?: string;
    headingFont?: string;
    heroStyle?: string;
    animationLevel?: string;
    themePreset?: string;
    heroLayout?: string;
    heroTextAlign?: string;
    heroOverlayStyle?: string;
    heroOverlayOpacity?: number;
    heroHeight?: string;
    headlineAccent?: string;
    /** How every band below the fold is drawn. See SECTION_SHAPES on the web. */
    navLoginStyle?: string;
    sectionShape?: string;
    /** WHAT a section does as it arrives; animationLevel stays the volume. */
    motionGesture?: string;
    backgroundTexture?: string;
    /**
     * The school's menu arrangement. Shape is validated on the WEB side by
     * validateNavConfig before it is ever sent — the rules there (six controls,
     * no empty group, no nesting, no lost page) are product rules with messages
     * an admin reads, not field constraints.
     */
    navConfig?: Record<string, unknown>;
    navStyle?: string;
    navColor?: string;
    navTextColor?: string;
    navCtaLabel?: string;
    navShowCta?: boolean;
    navLoginLabel?: string;
    navShowLogin?: boolean;
}
export declare class UpdateHomepageDto {
    headline?: string;
    subheadline?: string;
    aboutText?: string;
    principalName?: string;
    principalMessage?: string;
    heroAssetId?: string;
    heroImageAssetIds?: string[];
    principalPhotoAssetId?: string;
    aboutImageAssetId?: string;
    showAdmissions?: boolean;
    showGallery?: boolean;
    showEvents?: boolean;
    showContact?: boolean;
}
export declare class StatItemDto {
    label: string;
    value: string;
    order: number;
}
export declare class SetStatsDto {
    items: StatItemDto[];
}
export declare class SocialLinkDto {
    platform: string;
    url: string;
    order: number;
}
export declare class SetSocialDto {
    links: SocialLinkDto[];
}
export declare class UpsertStaffDto {
    name: string;
    role: string;
    photoAssetId?: string;
    order: number;
}
export declare class UpsertCourseDto {
    name: string;
    tagline?: string;
    description?: string;
    highlights?: string[];
    ageRange?: string;
    imageAssetId?: string;
    featured?: boolean;
    order: number;
}
export declare class UpsertCourseFeeDto {
    admissionFee?: string;
    annualFee?: string;
    includes?: string;
}
export declare class AdmissionStepDto {
    title: string;
    description?: string;
    order: number;
}
export declare class SetAdmissionStepsDto {
    steps: AdmissionStepDto[];
}
export declare class UpdateAdmissionsSettingsDto {
    showFeesPublicly?: boolean;
    feeNote?: string;
}
export declare class HallOfFameEntryDto {
    rank: number;
    name: string;
    achievement?: string;
    year?: string;
    photoAssetId?: string;
}
export declare class SetHallOfFameDto {
    entries: HallOfFameEntryDto[];
}
//# sourceMappingURL=cms.dto.d.ts.map