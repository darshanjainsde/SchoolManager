import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { PublicEvent } from '../community/community.dto';

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
  } | null;
  homepage: {
    headline: string;
    subheadline: string | null;
    heroUrl: string | null;
    aboutText: string | null;
    principalName: string | null;
    principalMessage: string | null;
    principalPhotoUrl: string | null;
  } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];
  gallery: { url: string; caption: string | null }[];
  staff: { name: string; role: string; photoUrl: string | null }[];
  menu: { label: string; gradeId: string }[];
  events: PublicEvent[];
}
