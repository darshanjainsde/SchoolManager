/**
 * Header copy for each dedicated section page of a school site.
 *
 * It lives in its own module, with NO component or font imports, so that the
 * nav model's test can assert every page here is reachable from the menu — a
 * page that exists in no group is a page the school silently loses. Importing
 * it from PublicSite.tsx instead would drag `next/font`'s Inter() into the test
 * environment, where it does not exist, and take the whole suite down with it.
 */
export const SUBPAGES: Record<string, { eyebrow: string; title: string; blurb: string }> = {
  academics: {
    eyebrow: 'Academics',
    title: 'Programmes at {school}',
    blurb: 'Everything we offer, from the earliest years up — tap a programme in the menu above to jump straight to it.',
  },
  admissions: {
    eyebrow: 'Admissions',
    title: 'Joining {school}',
    blurb: 'How admissions work, step by step — and the full fee structure.',
  },
  gallery: {
    eyebrow: 'Gallery',
    title: 'Life at {school}',
    blurb: 'Moments from classrooms, playgrounds and celebrations across the campus.',
  },
  events: {
    eyebrow: 'Connect · Events',
    title: 'Events & community',
    blurb: 'Everything happening at our school and across the network — one shared calendar.',
  },
  contact: {
    eyebrow: 'Contact',
    title: 'Get in touch',
    blurb: 'Reach the front office directly or leave your details — admissions responds within a working day.',
  },
};
