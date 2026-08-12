import type { PublicSiteData } from '@/lib/public-api';
import { FONT_STACK } from '@/lib/font-stack';
import { isNearWhite, lighten } from '@/components/public/site-utils';

/**
 * Pure theme + copy model for the Gatehouse login. Kept free of React so the
 * fallback rules and role copy are unit-testable without rendering the page.
 */
export interface LoginTheme {
  schoolName: string;
  tagline: string;
  logoUrl: string | null;
  /** Brand hexes; drive the whole page via the --gh-p / --gh-s CSS variables. */
  primary: string;
  secondary: string;
  /** CSS font-family value for identity text (school heading font). */
  fontStack: string;
  /** Bare request host, port stripped — shown as "the school's own system". */
  hostname: string;
  /** false = Sckools fallback look (platform host, fetch miss, or no profile). */
  branded: boolean;
}

/**
 * The whole-identity fallback. A school with no profile gets ALL of this —
 * colors are never mixed half-and-half with tenant data, so an unbranded
 * school still looks intentional rather than half-themed.
 */
export const SCKOOLS_FALLBACK = {
  primary: '#4F46E5',
  secondary: '#F59E0B',
  fontStack: FONT_STACK.INTER,
} as const;

export function resolveLoginTheme(data: PublicSiteData | null, host: string): LoginTheme {
  const hostname = host.split(':')[0].toLowerCase();
  const school = data?.school ?? null;
  const profile = data?.profile ?? null;

  const schoolName = school?.name ?? 'Sckools';
  const tagline =
    data?.homepage?.subheadline ??
    (profile?.city ? `${profile.city}` : school ? 'School sign-in' : 'Sign in to your school');

  if (!profile) {
    return {
      schoolName,
      tagline,
      logoUrl: null,
      primary: SCKOOLS_FALLBACK.primary,
      secondary: SCKOOLS_FALLBACK.secondary,
      fontStack: SCKOOLS_FALLBACK.fontStack,
      hostname,
      branded: false,
    };
  }

  const primary = profile.brandColorPrimary || SCKOOLS_FALLBACK.primary;
  // Same guard as themeRootProps: a near-white secondary makes every gradient
  // stop invisible, so lighten the primary instead of using it raw.
  const rawSecondary = profile.brandColorSecondary || SCKOOLS_FALLBACK.secondary;
  const secondary = isNearWhite(rawSecondary) ? lighten(primary, 0.4) : rawSecondary;

  return {
    schoolName,
    tagline,
    logoUrl: profile.logoUrl,
    primary,
    secondary,
    fontStack: FONT_STACK[profile.headingFont] ?? SCKOOLS_FALLBACK.fontStack,
    hostname,
    branded: true,
  };
}

export type RoleTab = 'STUDENT' | 'TEACHER' | 'ADMIN';

/**
 * The selector is a convenience only — it picks the copy/keyboard, never the
 * destination. Routing after login always follows the role the API reports
 * (see homeForRole). Student copy stays role-neutral: parents share the
 * student login until the pay module lands.
 */
export const ROLE_TABS: {
  value: RoleTab;
  label: string;
  sub: string;
  idLabel: string;
  submit: string;
  hint: string;
  plate: string;
  inputType: 'text' | 'email';
}[] = [
  {
    value: 'STUDENT',
    label: 'Student',
    sub: 'Homework, diary, attendance & results',
    idLabel: 'Student code, admission no. or email',
    submit: 'Enter student portal',
    hint: 'Use the student code on your school letter (like RAF-00042), the admission number, or the email on the record.',
    plate: 'Student entrance',
    inputType: 'text',
  },
  {
    value: 'TEACHER',
    label: 'Teacher',
    sub: 'Classes, attendance & leave',
    idLabel: 'Email',
    submit: 'Enter staff room',
    hint: 'Teachers use the email address the school invited them with.',
    plate: 'Staff entrance',
    inputType: 'email',
  },
  {
    value: 'ADMIN',
    label: 'Admin & Office',
    sub: 'Run the school',
    idLabel: 'Email',
    submit: 'Open admin console',
    hint: 'School admins and office staff manage the school here.',
    plate: 'Office entrance',
    inputType: 'email',
  },
];
