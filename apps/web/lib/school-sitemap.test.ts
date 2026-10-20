// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSchoolSitemap } from './school-sitemap';

describe('buildSchoolSitemap', () => {
  it('lists the school root and only the pages its tier can serve', () => {
    const urls = buildSchoolSitemap('https://raffles.sckools.com', {
      school: { features: ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL'] },
    }).map((u) => u.url);
    expect(urls).toEqual([
      'https://raffles.sckools.com/',
      'https://raffles.sckools.com/academics',
      'https://raffles.sckools.com/admissions',
      'https://raffles.sckools.com/gallery',
    ]);
  });

  it('adds contact, connect and blog for a Standard school, plus its own pages', () => {
    const urls = buildSchoolSitemap('https://beacon.sckools.com/', {
      school: { features: ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS', 'BLOG'] },
      pages: [{ slug: 'transport' }, { slug: 'fee structure' }],
    }).map((u) => u.url);
    expect(urls).toContain('https://beacon.sckools.com/contact');
    expect(urls).toContain('https://beacon.sckools.com/connect');
    expect(urls).toContain('https://beacon.sckools.com/blog');
    expect(urls).toContain('https://beacon.sckools.com/p/transport');
    expect(urls).toContain('https://beacon.sckools.com/p/fee%20structure');
  });

  it('never points a school at the marketing site', () => {
    const urls = buildSchoolSitemap('https://raffles.sckools.com', { school: { features: ['PUBLIC_SITE'] } }).map((u) => u.url);
    expect(urls.some((u) => u.startsWith('https://sckools.com'))).toBe(false);
  });
});
