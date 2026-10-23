// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LP_FAQ } from '@/components/marketing/lp-faq-data';

/**
 * Pricing is per student, per year. The website-builder landing page and its
 * FAQ (which is also FAQPage JSON-LD) said "one flat yearly plan" three times,
 * so the page most likely to be a visitor's first contradicted the pricing
 * page. Copy that describes the price model is checked here as text.
 */
const src = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('marketing copy describes the real price model', () => {
  it('never calls the price flat', () => {
    expect(src('school-website-builder/page.tsx')).not.toMatch(/flat yearly/i);
    expect(src('about/page.tsx')).not.toMatch(/flat yearly/i);
    for (const f of LP_FAQ) expect(f.a).not.toMatch(/flat yearly/i);
  });
  it('says per student on the builder page', () => {
    expect(src('school-website-builder/page.tsx')).toMatch(/per student/);
  });
});
