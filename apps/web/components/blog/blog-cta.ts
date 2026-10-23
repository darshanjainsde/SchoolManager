/**
 * The line under a network blog post.
 *
 * Every post used to end with "See how Sckools builds school websites": the
 * right ask for a principal reading about website costs, and a non-sequitur
 * for a parent who just read about the ten-minute daily habit. The audience is
 * read off the slug, which is the one thing every post has and the editor
 * already chooses deliberately.
 */
export type BlogAudience = 'leaders' | 'community';

const LEADER_WORDS = /(website|admission|principal|school-cost|erp|fees?|management|enquir)/i;

export function blogAudienceFor(slug: string): BlogAudience {
  return LEADER_WORDS.test(slug) ? 'leaders' : 'community';
}

export const BLOG_CTA: Record<BlogAudience, { lead: string; links: { href: string; label: string }[] }> = {
  leaders: {
    lead: 'Want the whole checklist handled for you?',
    links: [
      { href: '/school-website-builder', label: 'See how Sckools builds school websites' },
      { href: '/pricing', label: 'plans and pricing' },
    ],
  },
  community: {
    lead: 'Found this useful? Share it with your school.',
    links: [
      { href: '/#family', label: 'If your school runs on Sckools, ask them for the family app' },
      { href: '/blog', label: 'more guides' },
    ],
  },
};
