import { describe, expect, it } from 'vitest';
import { resolveLoginTheme, ROLE_TABS, SCKOOLS_FALLBACK } from './gatehouse-theme';
import type { PublicSiteData } from '@/lib/public-api';

/** Minimal branded tenant — only the fields the resolver reads are real. */
function brandedData(overrides?: Partial<PublicSiteData['profile']>): PublicSiteData {
  return {
    school: { name: 'Raffles International School', slug: 'raffles', tier: 'PRO', features: [], timezone: 'Asia/Kolkata' },
    profile: {
      logoUrl: 'https://cdn.example.com/raffles.png',
      faviconUrl: null,
      brandColorPrimary: '#0F6B4F',
      brandColorSecondary: '#C9A227',
      phone: null, email: null,
      addressLine1: null, addressLine2: null,
      city: 'Pune', region: null, postalCode: null, country: null,
      mapEmbedUrl: null,
      headingFont: 'FRAUNCES',
      heroStyle: 'PHOTO', animationLevel: 'FULL', heroLayout: 'FULL_BLEED',
      heroTextAlign: 'LEFT', heroOverlayStyle: 'WASH', heroOverlayOpacity: 65,
      heroHeight: 'FULL', headlineAccent: 'DRAW',
      navStyle: 'CLASSIC', navColor: 'PAPER', navTextColor: 'AUTO',
      navCtaLabel: 'Enquire', navShowCta: true, navShowLogin: true, navLoginLabel: 'Login',
      ...overrides,
    },
    homepage: {
      headline: 'Welcome', subheadline: 'Curiosity first, since 1987',
      heroUrl: null, heroImages: [], aboutText: null,
      principalName: null, principalMessage: null, principalPhotoUrl: null,
      aboutImageUrl: null,
      showAdmissions: true, showGallery: true, showEvents: true, showContact: true,
    },
    stats: [], socialLinks: [], gallery: [], staff: [], courses: [],
    admissions: { steps: [], showFees: false, feeNote: null },
    events: [],
  };
}

describe('resolveLoginTheme', () => {
  it('maps a branded school: name, colors, font stack, logo, tagline', () => {
    const t = resolveLoginTheme(brandedData(), 'raffles.sckools.com');
    expect(t.branded).toBe(true);
    expect(t.schoolName).toBe('Raffles International School');
    expect(t.primary).toBe('#0F6B4F');
    expect(t.secondary).toBe('#C9A227');
    expect(t.fontStack).toContain('--f-fraunces');
    expect(t.logoUrl).toBe('https://cdn.example.com/raffles.png');
    expect(t.tagline).toBe('Curiosity first, since 1987');
  });

  it('falls back to the city when there is no subheadline', () => {
    const data = brandedData();
    data.homepage = null;
    const t = resolveLoginTheme(data, 'raffles.sckools.com');
    expect(t.tagline).toContain('Pune');
  });

  it('uses the Sckools fallback when the site has no profile', () => {
    const data = brandedData();
    data.profile = null;
    const t = resolveLoginTheme(data, 'raffles.sckools.com');
    // Name still belongs to the school; identity colors fall back whole, never half.
    expect(t.schoolName).toBe('Raffles International School');
    expect(t.primary).toBe(SCKOOLS_FALLBACK.primary);
    expect(t.secondary).toBe(SCKOOLS_FALLBACK.secondary);
    expect(t.branded).toBe(false);
  });

  it('uses the full Sckools fallback when there is no site data at all', () => {
    const t = resolveLoginTheme(null, 'sckools.com');
    expect(t.schoolName).toBe('Sckools');
    expect(t.primary).toBe('#4F46E5');
    expect(t.secondary).toBe('#F59E0B');
    expect(t.logoUrl).toBeNull();
    expect(t.branded).toBe(false);
  });

  it('unknown heading font falls back to the Inter stack, not undefined', () => {
    const t = resolveLoginTheme(brandedData({ headingFont: 'COMIC_SANS' }), 'raffles.sckools.com');
    expect(t.fontStack).toContain('--f-inter');
  });

  it('replaces a near-white secondary with a lightened primary (gradient guard)', () => {
    const t = resolveLoginTheme(brandedData({ brandColorSecondary: '#FDFDFB' }), 'raffles.sckools.com');
    expect(t.secondary).not.toBe('#FDFDFB');
    expect(t.secondary).not.toBe(t.primary);
  });

  it('strips the port from the hostname', () => {
    const t = resolveLoginTheme(null, 'beacon.localhost:3000');
    expect(t.hostname).toBe('beacon.localhost');
  });
});

describe('ROLE_TABS', () => {
  it('has the three tenant roles in order', () => {
    expect(ROLE_TABS.map((r) => r.value)).toEqual(['STUDENT', 'TEACHER', 'ADMIN']);
  });

  it('student identifier accepts non-email values; staff roles use email inputs', () => {
    const [student, teacher, admin] = ROLE_TABS;
    expect(student.inputType).toBe('text');
    expect(teacher.inputType).toBe('email');
    expect(admin.inputType).toBe('email');
  });

  it('keeps the student-code identifier copy from the current page', () => {
    const student = ROLE_TABS[0];
    expect(student.idLabel).toBe('Student code, admission no. or email');
    expect(student.hint).toContain('RAF-00042');
  });

  it('student copy stays role-neutral for shared parent logins', () => {
    const student = ROLE_TABS[0];
    const copy = `${student.label} ${student.sub} ${student.hint}`.toLowerCase();
    expect(copy).not.toContain('only');
    expect(copy).not.toContain('students only');
  });

  it('every role has an entrance plate for the identity panel', () => {
    expect(ROLE_TABS.map((r) => r.plate)).toEqual(['Student entrance', 'Staff entrance', 'Office entrance']);
  });
});
