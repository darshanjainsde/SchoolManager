import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { PublicEvent } from '../community';

export class SubmitEnquiryDto {
  @IsString()
  @Length(1, 120)
  parentName!: string;

  @IsString()
  @Length(1, 40)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  gradeInterest?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  message?: string;
}

export class SetEnquiryStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'CLOSED'])
  status!: 'NEW' | 'CONTACTED' | 'CLOSED';
}

export interface PublicSiteData {
  school: {
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    features: string[];
    timezone: string;
  };
  profile: {
    logoUrl: string | null;
    faviconUrl: string | null;
    brandColorPrimary: string;
    brandColorSecondary: string;
    phone: string | null;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    mapEmbedUrl: string | null;
    headingFont: string;
    heroStyle: string;
    animationLevel: string;
    heroLayout: string;
    heroTextAlign: string;
    heroOverlayStyle: string;
    heroOverlayOpacity: number;
    heroHeight: string;
    headlineAccent: string;
    navStyle: string;
    navColor: string;
    navTextColor: string;
    navCtaLabel: string;
    navShowCta: boolean;
    navShowLogin: boolean;
    navLoginLabel: string;
    navLoginStyle: string;
    /** Website-studio axes. */
    scrollFeel: string;
    navDropdownAnim: string;
    heroMedia: string;
    heroVideoUrl: string | null;
    sectionVariants: unknown;
    festiveTheme: unknown;
    footerConfig: unknown;
    customSectionCss: unknown;
    customHtmlBlock: string | null;
  } | null;
  homepage: {
    headline: string;
    subheadline: string | null;
    heroUrl: string | null;
    heroImages: string[];
    aboutText: string | null;
    principalName: string | null;
    principalMessage: string | null;
    principalPhotoUrl: string | null;
    aboutImageUrl: string | null;
    showAdmissions: boolean;
    showGallery: boolean;
    showEvents: boolean;
    showContact: boolean;
  } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];
  gallery: { url: string; caption: string | null }[];
  staff: { name: string; role: string; photoUrl: string | null }[];
  courses: PublicCourse[];
  admissions: {
    steps: { title: string; description: string | null }[];
    showFees: boolean;
    feeNote: string | null;
  };
  /** Admin-built pages (published only), served at /p/<slug>. */
  pages: { slug: string; title: string; blocks: unknown }[];
  events: PublicEvent[];
}

export interface PublicCourse {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  highlights: string[];
  ageRange: string | null;
  imageUrl: string | null;
  featured: boolean;
  // null when the school hides fees or hasn't set them
  fee: { admissionFee: string | null; annualFee: string | null; includes: string | null } | null;
  hallOfFame: { rank: number; name: string; achievement: string | null; year: string | null; photoUrl: string | null }[];
}
