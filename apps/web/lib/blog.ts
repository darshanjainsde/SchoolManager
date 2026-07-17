/**
 * Data-only blog. Each post is an ordered list of sections rendered by
 * app/blog/[slug]/page.tsx — no MDX, no runtime markdown parsing.
 */
export interface PostSection {
  h?: string;      // h2 heading
  p?: string[];    // paragraphs
  ul?: string[];   // bullet list
}

export interface BlogPost {
  slug: string;
  title: string;        // <title> + Article headline
  description: string;  // meta description
  datePublished: string; // ISO date
  dateModified: string;
  readMinutes: number;
  sections: PostSection[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'how-to-build-a-school-website',
    title: 'How to Build a School Website in 2026: A Step-by-Step Guide for Indian Schools',
    description:
      'What a school website must include, what it costs, and the fastest way to get one live — a practical guide for principals and school administrators in India.',
    datePublished: '2026-07-17',
    dateModified: '2026-07-17',
    readMinutes: 6,
    sections: [
      {
        p: [
          'Parents no longer discover schools through hoardings and word of mouth alone — they search Google, and the school website is the first impression. Yet most school websites in India are either outdated agency builds nobody can edit, or don’t exist at all. This guide walks through exactly what it takes to build a school website in 2026, whichever route you choose.',
        ],
      },
      {
        h: 'Step 1: Secure your school’s domain',
        p: [
          'Your domain is your school’s permanent address on the internet — something like stxaviers-jaipur.com. Keep it short, close to the school’s real name, and owned by the school (not by a vendor). If a web agency registers the domain in their own name, changing vendors later becomes a hostage negotiation. Platforms like Sckools include a domain with every plan, registered for your school.',
        ],
      },
      {
        h: 'Step 2: Choose how you’ll build — agency, freelancer, or platform',
        ul: [
          'Web design agency: polished result, but a large one-time fee, yearly maintenance charges, and every text change goes through them.',
          'Freelancer: cheaper up front, but sites frequently rot when the freelancer moves on — no updates, no security patches, no support.',
          'School website platform: a purpose-built product where design, hosting, security and updates are included, and your own staff edit content. This is the route most new school sites take in 2026.',
        ],
      },
      {
        h: 'Step 3: Get the must-have pages right',
        p: ['Whatever you build with, a school website needs these pages before anything fancy:'],
        ul: [
          'Homepage — who the school is, in one screen, with real photos (not stock).',
          'Courses & academics — boards, streams, subjects, class levels.',
          'Admissions — the process, dates, fee structure, and above all a working enquiry form.',
          'Gallery — parents look at photos more than any other page.',
          'Staff & achievements — faculty, toppers, a hall of fame.',
          'Events — what’s happening this term.',
          'Contact — phone, email, address, map, timings.',
        ],
      },
      {
        h: 'Step 4: Treat admissions as a pipeline, not a page',
        p: [
          'The single biggest mistake schools make: an admissions page with a phone number and nothing else. Every enquiry should land in a tracked inbox where the office can mark it contacted, visited, admitted. If your website can’t tell you how many enquiries came in last month and what happened to them, it is a brochure, not an admissions tool.',
        ],
      },
      {
        h: 'Step 5: Handle the basics parents never see',
        ul: [
          'Mobile first — the majority of parent visits are from phones.',
          'HTTPS/SSL — browsers mark non-HTTPS sites "Not secure"; that kills trust instantly.',
          'Speed — image-heavy galleries must still load fast on 4G.',
          'SEO basics — every page needs a real title and description, so your school shows up when parents search its name plus your city.',
        ],
      },
      {
        h: 'The fastest route in 2026',
        p: [
          'If you have the budget and time for a custom agency build, it can work. But if you want the whole checklist above — domain, design, hosting, admissions pipeline, editable by your own staff — live within a week at a flat yearly price, that is exactly what Sckools does. Plus something no agency can offer: your school joins a live inter-school events network, where your fests reach students at every other Sckools school.',
        ],
      },
    ],
  },
  {
    slug: 'school-website-cost-india',
    title: 'How Much Does a School Website Cost in India? (2026 Breakdown)',
    description:
      'Agency, freelancer and platform pricing for school websites in India compared honestly — one-time costs, hidden yearly charges, and what should actually be included.',
    datePublished: '2026-07-17',
    dateModified: '2026-07-17',
    readMinutes: 5,
    sections: [
      {
        p: [
          'Ask three vendors what a school website costs and you’ll get three answers spanning a 10x range. That’s because the real cost of a school website isn’t the build — it’s everything after. Here’s the honest 2026 breakdown for Indian schools.',
        ],
      },
      {
        h: 'The three ways schools pay',
        ul: [
          'Agency build: typically a significant one-time design fee, plus yearly "maintenance" (hosting, SSL renewal, small edits). Every change beyond the contract is billed extra.',
          'Freelancer: lower one-time cost, but hosting, domain renewal and security updates become the school’s problem — and when the freelancer disappears, the site slowly breaks.',
          'Platform subscription: one flat yearly price that includes hosting, domain, SSL, design updates and support. No surprise invoices.',
        ],
      },
      {
        h: 'The hidden costs nobody quotes',
        ul: [
          'Content changes — fee structure updated? New principal? On an agency site, that’s a ticket and a wait; costs add up every single year.',
          'Domain held hostage — if the vendor owns your domain, switching vendors can mean losing your web address.',
          'Security & backups — an unpatched site gets hacked; cleaning that up costs more than the site did.',
          'The admissions leak — a site without enquiry tracking silently loses admissions leads, which is the most expensive cost of all.',
        ],
      },
      {
        h: 'What should be included at any price',
        p: ['Whoever you pay, insist the quote covers all of this in writing:'],
        ul: [
          'Your own domain, registered in the school’s name',
          'Hosting and SSL, renewed without extra invoices',
          'Mobile-perfect design with your school’s photos',
          'Admissions enquiry form that goes to a tracked inbox, not a lost email',
          'The ability for school staff to edit content without a developer',
        ],
      },
      {
        h: 'Where Sckools lands',
        p: [
          'Sckools was built to make this decision boring: every plan is a flat yearly price published openly on our pricing page, and it includes the entire checklist above — plus an inter-school events network and, on Pro, a full school management suite with portals for teachers and students. You can compare the plans on the pricing page and see exactly what each tier adds.',
        ],
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
