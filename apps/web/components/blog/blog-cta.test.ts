// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blogAudienceFor } from './blog-cta';

describe('blogAudienceFor', () => {
  it('sends school-leader posts to the sales ask', () => {
    expect(blogAudienceFor('how-to-build-a-school-website')).toBe('leaders');
    expect(blogAudienceFor('school-website-cost-india')).toBe('leaders');
    expect(blogAudienceFor('online-admissions-for-schools')).toBe('leaders');
  });
  it('gives students, parents and teachers a community ask instead', () => {
    expect(blogAudienceFor('how-to-study-for-board-exams-science')).toBe('community');
    expect(blogAudienceFor('how-parents-help-child-succeed-school')).toBe('community');
    expect(blogAudienceFor('evidence-based-teaching-strategies')).toBe('community');
  });
});
