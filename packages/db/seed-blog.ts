import { loadEnv } from '@skoolos/config';
loadEnv();
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import type { BlogBlock } from '@skoolos/db';

/**
 * Idempotent seed for the 5 PLATFORM blog posts shown on sckools.com/blog.
 * Upserts by (schoolId=null, slug) — safe to re-run.
 *
 *   1-2: converted from the old static registry, apps/web/lib/blog.ts (deleted
 *        once this seed ships — see plan Task 5).
 *   3-5: converted from the three approved interactive drafts reviewed at
 *        scratchpad/blog-research/drafts-review.html (teachers / students / parents).
 *
 * Run: pnpm --filter @skoolos/db seed:blog   (DIRECT_URL / local docker DB only)
 */

interface SeedPost {
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  publishedAt: string; // ISO date
  sections: BlogBlock[];
}

const POSTS: SeedPost[] = [
  // ───────────────────────────── 1: how-to-build-a-school-website ─────
  {
    slug: 'how-to-build-a-school-website',
    title: 'How to Build a School Website in 2026: A Step-by-Step Guide for Indian Schools',
    description:
      'What a school website must include, what it costs, and the fastest way to get one live — a practical guide for principals and school administrators in India.',
    heroImageUrl: null,
    readMinutes: 6,
    publishedAt: '2026-07-17',
    sections: [
      {
        t: 'p',
        text: 'Parents no longer discover schools through hoardings and word of mouth alone — they search Google, and the school website is the first impression. Yet most school websites in India are either outdated agency builds nobody can edit, or don’t exist at all. This guide walks through exactly what it takes to build a school website in 2026, whichever route you choose.',
      },
      { t: 'h', text: 'Step 1: Secure your school’s domain' },
      {
        t: 'p',
        text: 'Your domain is your school’s permanent address on the internet — something like stxaviers-jaipur.com. Keep it short, close to the school’s real name, and owned by the school (not by a vendor). If a web agency registers the domain in their own name, changing vendors later becomes a hostage negotiation. Platforms like Sckools include a domain with every plan, registered for your school.',
      },
      { t: 'h', text: 'Step 2: Choose how you’ll build — agency, freelancer, or platform' },
      {
        t: 'ul',
        items: [
          'Web design agency: polished result, but a large one-time fee, yearly maintenance charges, and every text change goes through them.',
          'Freelancer: cheaper up front, but sites frequently rot when the freelancer moves on — no updates, no security patches, no support.',
          'School website platform: a purpose-built product where design, hosting, security and updates are included, and your own staff edit content. This is the route most new school sites take in 2026.',
        ],
      },
      { t: 'h', text: 'Step 3: Get the must-have pages right' },
      { t: 'p', text: 'Whatever you build with, a school website needs these pages before anything fancy:' },
      {
        t: 'ul',
        items: [
          'Homepage — who the school is, in one screen, with real photos (not stock).',
          'Courses & academics — boards, streams, subjects, class levels.',
          'Admissions — the process, dates, fee structure, and above all a working enquiry form.',
          'Gallery — parents look at photos more than any other page.',
          'Staff & achievements — faculty, toppers, a hall of fame.',
          'Events — what’s happening this term.',
          'Contact — phone, email, address, map, timings.',
        ],
      },
      { t: 'h', text: 'Step 4: Treat admissions as a pipeline, not a page' },
      {
        t: 'p',
        text: 'The single biggest mistake schools make: an admissions page with a phone number and nothing else. Every enquiry should land in a tracked inbox where the office can mark it contacted, visited, admitted. If your website can’t tell you how many enquiries came in last month and what happened to them, it is a brochure, not an admissions tool.',
      },
      { t: 'h', text: 'Step 5: Handle the basics parents never see' },
      {
        t: 'ul',
        items: [
          'Mobile first — the majority of parent visits are from phones.',
          'HTTPS/SSL — browsers mark non-HTTPS sites "Not secure"; that kills trust instantly.',
          'Speed — image-heavy galleries must still load fast on 4G.',
          'SEO basics — every page needs a real title and description, so your school shows up when parents search its name plus your city.',
        ],
      },
      { t: 'h', text: 'The fastest route in 2026' },
      {
        t: 'p',
        text: 'If you have the budget and time for a custom agency build, it can work. But if you want the whole checklist above — domain, design, hosting, admissions pipeline, editable by your own staff — live within a week at a flat yearly price, that is exactly what Sckools does. Plus something no agency can offer: your school joins a live inter-school events network, where your fests reach students at every other Sckools school.',
      },
    ],
  },

  // ───────────────────────────── 2: school-website-cost-india ─────────
  {
    slug: 'school-website-cost-india',
    title: 'How Much Does a School Website Cost in India? (2026 Breakdown)',
    description:
      'Agency, freelancer and platform pricing for school websites in India compared honestly — one-time costs, hidden yearly charges, and what should actually be included.',
    heroImageUrl: null,
    readMinutes: 5,
    publishedAt: '2026-07-17',
    sections: [
      {
        t: 'p',
        text: 'Ask three vendors what a school website costs and you’ll get three answers spanning a 10x range. That’s because the real cost of a school website isn’t the build — it’s everything after. Here’s the honest 2026 breakdown for Indian schools.',
      },
      { t: 'h', text: 'The three ways schools pay' },
      {
        t: 'ul',
        items: [
          'Agency build: typically a significant one-time design fee, plus yearly "maintenance" (hosting, SSL renewal, small edits). Every change beyond the contract is billed extra.',
          'Freelancer: lower one-time cost, but hosting, domain renewal and security updates become the school’s problem — and when the freelancer disappears, the site slowly breaks.',
          'Platform subscription: one flat yearly price that includes hosting, domain, SSL, design updates and support. No surprise invoices.',
        ],
      },
      { t: 'h', text: 'The hidden costs nobody quotes' },
      {
        t: 'ul',
        items: [
          'Content changes — fee structure updated? New principal? On an agency site, that’s a ticket and a wait; costs add up every single year.',
          'Domain held hostage — if the vendor owns your domain, switching vendors can mean losing your web address.',
          'Security & backups — an unpatched site gets hacked; cleaning that up costs more than the site did.',
          'The admissions leak — a site without enquiry tracking silently loses admissions leads, which is the most expensive cost of all.',
        ],
      },
      { t: 'h', text: 'What should be included at any price' },
      { t: 'p', text: 'Whoever you pay, insist the quote covers all of this in writing:' },
      {
        t: 'ul',
        items: [
          'Your own domain, registered in the school’s name',
          'Hosting and SSL, renewed without extra invoices',
          'Mobile-perfect design with your school’s photos',
          'Admissions enquiry form that goes to a tracked inbox, not a lost email',
          'The ability for school staff to edit content without a developer',
        ],
      },
      { t: 'h', text: 'Where Sckools lands' },
      {
        t: 'p',
        text: 'Sckools was built to make this decision boring: every plan is a flat yearly price published openly on our pricing page, and it includes the entire checklist above — plus an inter-school events network and, on Pro, a full school management suite with portals for teachers and students. You can compare the plans on the pricing page and see exactly what each tier adds.',
      },
    ],
  },

  // ───────────────────────────── 3: evidence-based-teaching-strategies ─
  {
    slug: 'evidence-based-teaching-strategies',
    title: 'Evidence-Based Teaching Strategies, Ranked by Real Impact',
    description:
      'Decades of research ranked: which teaching strategies add the most months of learning — and which popular ones barely move the needle.',
    heroImageUrl: '/blog/teaching-strategies.png',
    readMinutes: 6,
    publishedAt: '2026-07-24',
    sections: [
      {
        t: 'p',
        text: "Education is full of confident advice. Very little of it comes with numbers. Here's what large-scale research actually says — including two results that surprise almost every teacher.",
      },
      {
        t: 'p',
        text: 'Every staff room has strong opinions about what makes teaching work: smaller classes, more homework, stricter discipline, smart boards. But for two decades, researchers have been measuring these things across thousands of classrooms — most famously the Education Endowment Foundation (EEF), whose Teaching & Learning Toolkit summarises evidence from millions of students into one simple unit: months of additional progress per year.',
      },
      {
        t: 'quiz',
        tag: 'Quick check — trust your instinct',
        q: 'Which of these adds more learning in a year, according to the evidence?',
        options: [
          'Extending the school day',
          'Teaching students to plan, monitor and evaluate their own learning',
          'Introducing more digital technology',
        ],
        correct: 1,
        why: "Metacognition wins — by a lot. Teaching students to think about how they learn adds around +7 months of progress per year at low cost. Extending school time adds just +2 months at high cost. Technology sits in the middle at +4 — it amplifies good teaching, it doesn't replace it.",
      },
      { t: 'h', text: 'The ranking most schools have never seen' },
      {
        t: 'ranking',
        items: [
          { label: 'Metacognition & self-regulation', value: '+7 months', pct: 100 },
          { label: 'Feedback', value: '+6 months', pct: 86 },
          { label: 'Reading comprehension strategies', value: '+6 months', pct: 86 },
          { label: 'Collaborative learning', value: '+5 months', pct: 71 },
          { label: 'Peer tutoring', value: '+5 months', pct: 71 },
          { label: 'Mastery learning', value: '+5 months', pct: 71 },
          { label: 'Behaviour interventions', value: '+4 months', pct: 57 },
          { label: 'Digital technology', value: '+4 months', pct: 57 },
          { label: 'Extending school time', value: '+2 months', pct: 29 },
        ],
        source:
          'Education Endowment Foundation, Teaching & Learning Toolkit — averages across thousands of studies; individual results vary by implementation.',
      },
      { t: 'h', text: '1. Metacognition: the +7-month strategy that costs almost nothing' },
      {
        t: 'p',
        text: 'The single highest-impact, lowest-cost approach on the list is teaching students to plan before a task ("what strategy will I use?"), monitor during it ("is this working?") and evaluate after ("what would I change next time?"). In practice this is as simple as ending a lesson with two questions: What did you find hardest today? What did you do about it? Students who reflect on their own thinking stop repeating the same mistakes — and the effect compounds all year.',
      },
      { t: 'h', text: '2. Feedback: +6 months — but only a specific kind' },
      {
        t: 'p',
        text: 'Research is clear that feedback is among the most powerful tools a teacher has — worth roughly six additional months of progress. But the evidence favours feedback that is specific, early, and actionable: "your conclusion doesn\'t answer the question you set in your introduction" beats "good effort, 6/10" every time. One study found clear communication of goals had a 32% higher effect on performance than simply holding high expectations. Marks without commentary are the least useful form of feedback there is.',
      },
      { t: 'h', text: '3. Structured group work and peer tutoring: +5 months each' },
      {
        t: 'p',
        text: 'Group work earns its reputation only when it\'s structured — defined roles, a task that genuinely requires talk, and individual accountability at the end. Unstructured "discuss in groups" mostly produces noise. Peer tutoring is the quiet star here: the tutor often gains as much as the tutee, because explaining a concept is a form of retrieval practice (more on that in our student guide).',
      },
      { t: 'h', text: 'What barely works — and what that means for your school' },
      {
        t: 'ul',
        items: [
          'Extending school time: +2 months, high cost. More hours of the same teaching produces little. Better teaching in existing hours produces much more.',
          'Technology by itself: +4 months, moderate cost. Devices amplify pedagogy; they are not pedagogy. A smart board running a lecture is still a lecture.',
          'Homework: it depends on age and design. Purposeful, feedback-linked homework helps secondary students; hours of repetitive work helps almost no one.',
        ],
      },
      {
        t: 'quiz',
        tag: 'One more — the feedback trap',
        q: 'A student scores 12/20 on an essay. Which returned comment does the evidence support?',
        options: [
          '"12/20 — you can do better, work harder next time."',
          '"Good effort! Nice handwriting and structure."',
          '"Your evidence in paragraph 2 is strong; your conclusion never answers the question. Rewrite just the conclusion."',
        ],
        correct: 2,
        why: 'The third one. It names what worked, names the gap, and gives one concrete next action. Grades alone (option 1) and vague praise (option 2) both fail the same test: the student finishes reading them knowing nothing new about how to improve.',
      },
    ],
  },

  // ───────────────────────────── 4: how-to-study-for-board-exams-science
  {
    slug: 'how-to-study-for-board-exams-science',
    title: 'How to Study for Board Exams: What Science Actually Says',
    description:
      "400+ studies agree: highlighting and re-reading barely work. Here's the study system that does — active recall, spaced repetition and the 2-3-5-7 rule.",
    heroImageUrl: '/blog/study-science.png',
    readMinutes: 6,
    publishedAt: '2026-07-24',
    sections: [
      {
        t: 'p',
        text: 'Most students study in ways science proved ineffective a decade ago. The good news: the methods that actually work are free, simple, and slightly uncomfortable.',
      },
      {
        t: 'quiz',
        tag: 'Start here — be honest',
        q: 'Which of these study methods do scientists rank LEAST effective?',
        options: [
          'Highlighting and re-reading your notes',
          'Testing yourself with the book closed',
          'Reviewing a topic again after a few days',
        ],
        correct: 0,
        why: 'Highlighting and re-reading — the two things most students do most. A landmark review of ten study techniques (Dunlosky et al., 2013, covering hundreds of studies) rated highlighting, re-reading and summarising as low utility. The two high utility winners: practice testing and spaced review — the other two options in this quiz.',
      },
      { t: 'h', text: 'The experiment every student should know' },
      {
        t: 'p',
        text: 'In 2006, researchers Roediger and Karpicke ran a simple experiment. Students studied a passage, then either re-read it or tested themselves on it. Two days later, the results were brutal:',
      },
      {
        t: 'stats',
        items: [
          { value: '−56%', label: 'forgotten within 2 days by students who re-read the material', tone: 'bad' },
          { value: '−13%', label: 'forgotten by students who tested themselves instead', tone: 'good' },
          { value: '+50%', label: 'higher scores for self-testers on delayed tests (Psychological Science)', tone: 'good' },
        ],
      },
      {
        t: 'p',
        text: 'Re-reading feels productive because the material looks familiar. But familiarity is not memory. Pulling an answer out of your head — struggling for it — is what builds the memory. Scientists call it active recall, and a 2021 meta-analysis of 242 studies with 169,000+ participants (Donoghue & Hattie) confirmed it as one of the two most effective techniques ever measured.',
      },
      { t: 'h', text: 'The second weapon: spaced repetition' },
      {
        t: 'p',
        text: "The other winner is when you review. Cramming stores information just long enough to lose it. Reviewing at growing intervals — just as you're about to forget — locks it in. A meta-analysis of 254 studies (Cepeda et al.) found spaced review beat massed cramming in almost every condition tested.",
      },
      {
        t: 'p',
        text: 'The simplest version is the 2-3-5-7 rule used by board-exam toppers: revise a topic 2 days after learning it, then 3 days later, then 5, then 7 — each pass faster than the last, from memory first, notes second.',
      },
      { t: 'h', text: 'Build the system in 20 minutes' },
      {
        t: 'ul',
        items: [
          'After every chapter, write 5 questions (not notes — questions). "What causes X?" "Derive Y." That\'s your test bank.',
          'Study session = closed book first. Answer your questions from memory, then open the book to check. The struggle is the workout.',
          'Schedule with 2-3-5-7. A wall calendar or a flashcard app (Anki is free) does the remembering-to-remember for you.',
          "Past papers are the ultimate active recall. Every board topper you've heard of solved years of them under exam conditions. Now you know why it works.",
          "Explain it to someone. Teaching a friend (or an empty chair) is retrieval practice in disguise — if you can't explain it, you haven't learned it yet.",
        ],
      },
      {
        t: 'quiz',
        tag: 'Apply it',
        q: "It's 10 days before your physics board exam. Which plan does the research back?",
        options: [
          'Re-read the full textbook once, highlighting key formulas',
          'Watch topic videos for all chapters back to back',
          'Alternate days of past papers (closed book) with review of only the questions you got wrong',
        ],
        correct: 2,
        why: 'Past papers + error review. It combines active recall (solving under exam conditions), spacing (alternating days), and feedback (reviewing errors). Options 1 and 2 are passive input — they feel safe and produce the 56%-gone-in-two-days result.',
      },
    ],
  },

  // ───────────────────────────── 5: how-parents-help-child-succeed-school
  {
    slug: 'how-parents-help-child-succeed-school',
    title: 'What Actually Helps Your Child Do Well at School (Research)',
    description:
      '450 studies agree: what parents do at home predicts school success 2× more than income. What works, what backfires, and the 10-minute daily habit.',
    heroImageUrl: '/blog/parents-guide.png',
    readMinutes: 5,
    publishedAt: '2026-07-24',
    sections: [
      {
        t: 'p',
        text: "You don't need tuition classes, a bigger house, or an engineering degree. Four decades of research says the strongest lever is free — and most parents pull the wrong one.",
      },
      {
        t: 'p',
        text: 'In the 1980s, researcher Herbert Walberg studied what he called the "alterable curriculum of the home" — the conversations, routines and encouragement parents control. His finding, confirmed since by nearly 450 studies: what parents do with children is about twice as predictive of academic learning as socioeconomic status. Twice. What you do beats what you earn.',
      },
      {
        t: 'quiz',
        tag: 'The report card moment',
        q: 'Your child brings home 62/100 in maths. Which response does the research support?',
        options: [
          '"Only 62? From tomorrow, one extra hour of maths daily. No cricket till it improves."',
          '"What part of the paper felt hardest? Show me one question you almost got."',
          '"Don\'t worry — I was also bad at maths. It runs in the family."',
        ],
        correct: 1,
        why: 'Option 2 — curiosity before consequences. Research on "discussion and encouragement" shows conversations about the learning beat punishment and pressure. And option 3 quietly does real damage: saying "I\'m not a maths person" teaches your child that ability is fixed — teachers specifically ask parents never to model this belief.',
      },
      { t: 'h', text: 'The engagement cliff nobody warns you about' },
      {
        t: 'stats',
        items: [
          { value: '76%', label: 'of children love school in grade 3', tone: 'good' },
          { value: '24%', label: 'still love it by grade 10', tone: 'bad' },
          { value: '2×', label: 'home habits vs family income as a predictor of learning (Walberg)', tone: 'good' },
        ],
      },
      {
        t: 'p',
        text: 'Love of school collapses precisely in the years parents disengage — when "how was school?" starts getting "fine" and we stop asking anything else. The research points to the antidote, and it isn\'t homework supervision.',
      },
      { t: 'h', text: 'What works (in order of evidence)' },
      {
        t: 'ul',
        items: [
          'Talk about the learning, not the marks. "What\'s the most interesting thing in science right now?" beats "finish your homework." Discussions about ideas, interests and challenges are what researchers call the fertile ground of motivation.',
          'Protect the routine. Fixed meal times, a quiet study place, a firm bedtime. Boring, unglamorous, and repeatedly shown to matter — sleep-deprived children cannot encode memory, whatever the tuition bill says.',
          'Ask the school things, not just result things. Children whose parents show up — PTMs, school events, a message to the class teacher — earn higher grades and drop out less. Your presence signals that school matters.',
          'Model curiosity and growth. Let them see you read, ask questions, get things wrong and try again. Never announce that anyone in the family "isn\'t a maths person."',
          "Start with strengths. Ask about the favourite subject before the struggling one — children who are reminded of what they're good at engage longer with what they're not.",
        ],
      },
      { t: 'h', text: 'What backfires' },
      {
        t: 'ul',
        items: [
          'Quiz-style homework policing. Hovering and re-checking every answer reduces independence — encourage the child to attempt alone, then discuss.',
          'Grades-only conversations. If the only school talk is marks talk, school becomes a performance review. Engagement dies there.',
          'Comparison with cousins, neighbours, toppers. No study anywhere has found this to help. Every parent does it anyway. Stop.',
        ],
      },
      { t: 'h', text: 'The 10-minute daily habit' },
      {
        t: 'p',
        text: 'If you take one thing: ten minutes a day of genuine conversation about what they\'re learning — not how they scored. "Teach me what you did in history today" is secretly the most powerful thing in this article: to teach you, your child has to retrieve and organise the material, which (as our student guide explains) is exactly how memory is built. You\'re not just bonding. You\'re revising.',
      },
    ],
  },
];

async function main() {
  const db = getPlatformPrisma();

  for (const post of POSTS) {
    const publishedAt = new Date(`${post.publishedAt}T00:00:00.000Z`);
    const data = {
      title: post.title,
      description: post.description,
      heroImageUrl: post.heroImageUrl,
      readMinutes: post.readMinutes,
      sections: post.sections as unknown as object[],
      status: 'PUBLISHED' as const,
      globalStatus: 'APPROVED' as const,
      globalSlug: post.slug,
      publishedAt,
    };

    // Prisma's compound-unique lookup (schoolId_slug) rejects a literal `null`
    // for the nullable `schoolId` half at runtime (validated non-null even
    // though the column is nullable) — see prisma/seed.ts's User upsert for
    // the same caveat. findFirst + create/update sidesteps it.
    const existing = await db.blogPost.findFirst({ where: { schoolId: null, slug: post.slug } });
    if (existing) {
      await db.blogPost.update({ where: { id: existing.id }, data });
    } else {
      await db.blogPost.create({ data: { scope: 'PLATFORM', schoolId: null, slug: post.slug, ...data } });
    }
    console.log(`upserted: ${post.slug} (${post.sections.length} blocks)`);
  }

  console.log('\n──── BLOG SEED COMPLETE ────');
  await disconnectAll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
