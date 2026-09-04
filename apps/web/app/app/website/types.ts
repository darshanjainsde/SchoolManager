/** Local mirrors of the API's site-content shapes — the web app cannot import API types. */

export interface SiteProfile {
  brandColorPrimary?: string | null;
  brandColorSecondary?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  mapEmbedUrl?: string | null;
  /** Statutory head for the Press: "CBSE, New Delhi" + affiliation number. */
  board?: string | null;
  affiliationNo?: string | null;
  logoAssetId?: string | null;
  faviconAssetId?: string | null;
  headingFont?: string | null;
  heroStyle?: string | null;
  animationLevel?: string | null;
  themePreset?: string | null;
}

export interface SiteHomepage {
  headline?: string | null;
  subheadline?: string | null;
  aboutText?: string | null;
  principalName?: string | null;
  principalMessage?: string | null;
  heroAssetId?: string | null;
  principalPhotoAssetId?: string | null;
  aboutImageAssetId?: string | null;
  showAdmissions?: boolean;
  showGallery?: boolean;
  showEvents?: boolean;
  showContact?: boolean;
}

export const HOMEPAGE_SECTIONS = [
  { key: 'showAdmissions', label: 'Admissions', detail: 'Process steps and fee table · full page at /admissions' },
  { key: 'showGallery', label: 'Gallery', detail: 'Photo grid · full page at /gallery' },
  { key: 'showEvents', label: 'Connect (events)', detail: 'Network events calendar · full page at /connect' },
  { key: 'showContact', label: 'Contact & enquiry', detail: 'Contact card and enquiry form · full page at /contact' },
] as const;

export interface StatRow {
  id?: string;
  label: string;
  value: string;
  order: number;
}

export interface SocialLink {
  id?: string;
  platform: string;
  url: string;
  order: number;
}

export interface SiteContent {
  profile: SiteProfile;
  homepage: SiteHomepage;
  stats: StatRow[];
  socialLinks: SocialLink[];
}

export interface MediaAsset {
  id: string;
  kind: string;
  url: string;
  storageKey: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  photoAssetId?: string | null;
  order: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'X', 'LINKEDIN'] as const;

/** CSS font stacks for the school's chosen heading family. */
export const FONT_FAMILY: Record<string, string> = {
  INTER: "'Inter', sans-serif",
  FRAUNCES: "'Fraunces', serif",
  POPPINS: "'Poppins', sans-serif",
  NUNITO: "'Nunito', sans-serif",
};
