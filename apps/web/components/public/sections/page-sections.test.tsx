import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GallerySection from './GallerySection';
import ContactSection from './ContactSection';
import type { PublicSiteData } from '@/lib/public-api';

vi.mock('../enquiry-client', () => ({ submitEnquiry: vi.fn().mockResolvedValue('ok') }));

/**
 * THE AUDIT FINDINGS, §5 OF THE PHASE 6 PLAN.
 *
 * Two of them, measured against the components rather than asserted:
 *
 * 1. THE DUPLICATE HEADING IS NOT ONLY ON /ACADEMICS. Gallery, Events and
 *    Contact each carry their own eyebrow and heading, and each is ALSO
 *    rendered under a page masthead that already said it. Academics was fixed
 *    with `onOwnPage`; these were not.
 *
 * 2. CONTACT HAS ZERO SCROLL REVEALS while every other band has one to four.
 *    A page that has been animating all the way down simply stops at the last
 *    section, which reads as something failing to load rather than as a choice.
 */

const PROFILE = {
  phone: '+91 80 1234 5678',
  email: 'office@example.com',
  addressLine1: '12 Residency Road',
  addressLine2: null,
  city: 'Bengaluru',
  region: 'Karnataka',
  postalCode: '560025',
  country: 'India',
  mapEmbedUrl: null,
} as unknown as PublicSiteData['profile'];

const GALLERY = [
  { url: 'https://example.com/a.jpg', caption: 'Sports day' },
  { url: 'https://example.com/b.jpg', caption: null },
];

describe('the gallery on the home page', () => {
  it('introduces itself, because nothing above it has', () => {
    render(<GallerySection gallery={GALLERY} schoolName="Raffles" />);
    expect(screen.getByText('Gallery')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Life at Raffles/ })).toBeInTheDocument();
  });
});

describe('the gallery as the whole /gallery page', () => {
  it('drops its own eyebrow and heading — the masthead already said both', () => {
    render(<GallerySection gallery={GALLERY} schoolName="Raffles" onOwnPage />);
    expect(screen.queryByText('Gallery')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Life at Raffles/ })).not.toBeInTheDocument();
  });

  it('still shows every photo — only the repeated heading goes', () => {
    render(<GallerySection gallery={GALLERY} schoolName="Raffles" onOwnPage />);
    expect(screen.getAllByRole('button', { name: /full size/i }).length).toBe(2);
  });

  it('draws an empty state rather than a 48px emoji when there are no photos', () => {
    const { container } = render(<GallerySection gallery={[]} schoolName="Raffles" onOwnPage />);
    expect(screen.getByText(/no photos yet/i)).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.textContent).not.toContain('📷');
  });
});

describe('contact', () => {
  function renderContact(onOwnPage?: boolean) {
    return render(
      <ContactSection
        profile={PROFILE}
        socialLinks={[]}
        hasEnquiry
        courses={['Preschool']}
        schoolName="Raffles"
        onOwnPage={onOwnPage}
      />,
    );
  }

  it('animates in like every band above it, instead of stopping dead', () => {
    // Measured, not asserted: the section had ZERO reveal elements while its
    // neighbours had one to four, so the page's motion ended mid-scroll.
    const { container } = renderContact();
    expect(container.querySelectorAll('.reveal').length).toBeGreaterThan(0);
  });

  it('introduces itself on the home page', () => {
    renderContact();
    expect(screen.getByRole('heading', { name: /Ready to join us/i })).toBeInTheDocument();
  });

  it('drops the duplicated heading when it IS the /contact page', () => {
    // The /contact masthead already says "Get in touch" and explains the desk;
    // a second 4xl heading under it is the same bug academics had.
    renderContact(true);
    expect(screen.queryByRole('heading', { name: /Ready to join us/i })).not.toBeInTheDocument();
  });

  it('still gives the visitor a way to reach the school on its own page', () => {
    renderContact(true);
    expect(screen.getByText(/office@example.com/)).toBeInTheDocument();
  });
});
