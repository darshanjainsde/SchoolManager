#!/usr/bin/env node
/**
 * The marketing site is ONE self-contained page (public/site-preview/index.html)
 * served on four routes. Each route must carry its own <title>, description,
 * canonical and Open Graph tags, so the other three files are derived from
 * index.html here — never hand-edited. Edit index.html, run
 * `node scripts/site-preview-sync.mjs`, commit all four.
 * app/site-preview.test.ts fails if the four bodies drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/site-preview');

export const ROUTES = {
  index: {
    path: '/',
    title: 'Sckools — School Website, Management Software (ERP) & Parent App',
    description:
      'A school website, school management software (ERP) and a parent app in one login, priced per student per year. Admissions desk, fees, attendance register, report cards, library, Sckools TV.',
  },
  pricing: {
    path: '/pricing',
    title: 'Sckools Pricing — Per Student, Per Year',
    description:
      'Basic, Standard and Pro, priced per student per year with nothing hidden. Website to report cards, app included. Pick your modules and add more whenever you are ready.',
  },
  features: {
    path: '/features',
    title: 'Sckools Features — Every Desk in the School, One Login',
    description:
      'The website studio, admissions desk, fees and receipts, the register, timetable, report cards, library, family app and the reception TV — what each one does, at a glance.',
  },
  start: {
    path: '/start',
    title: 'Get Sckools for Your School — Build Your Quote',
    description:
      'Pick the modules your school needs, tell us your size, and get an exact per-year figure with a callback. Pay only for what you use; add features any time.',
  },
};

/**
 * Crawlable copy per route. The script replaces #app's contents on first
 * render, so this is what a crawler, a link preview or a screen reader with
 * scripts off sees — it must describe THIS route, not the home page.
 */
const LINKS =
  '<a href="/pricing">Full pricing</a> · <a href="/features">Every feature</a> · <a href="/start">Build your quote</a> · <a href="/school-website-builder">School website builder</a> · <a href="/blog">Blog</a> · <a href="/about">About Sckools</a>';
const CONTACT = '<p>Call +91 95994 43324 or write to admin@sckools.com. A real person calls back within one working day.</p>';
const PLANS =
  '<p>Plans, per student per year: <b>Basic ₹30</b> (website and admissions desk) · <b>Standard ₹45</b> (plus the events network, blog, about and contact pages) · <b>Pro ₹60</b> (plus the office, the staff room and the family app).</p>';
export const STATIC = {
  index: `<h1 style="font-size:2.2rem;line-height:1.15;margin:0 0 12px">Your school, on a bigger stage</h1>
<p style="font-size:1.1rem;max-width:62ch">Sckools is a school website, school management software (what most vendors call an ERP) and a family app, in one login at one price per student. The admissions desk, fees and receipts, the attendance register, report cards, the library, the TV in reception, and a live network of schools where your students compete and get discovered.</p>
${PLANS}<p>${LINKS}</p>${CONTACT}`,
  pricing: `<h1 style="font-size:2.2rem;line-height:1.15;margin:0 0 12px">Sckools pricing: per student, per year, nothing hidden</h1>
<p style="font-size:1.1rem;max-width:62ch">One number per student, billed once a year. Hosting, your own domain, SSL, updates every month and support are included. No per-teacher seats, no setup fee, no charge for the app. Switch on more modules whenever you are ready.</p>
${PLANS}<p>For 500 students: Basic ₹15,000 a year, Standard ₹22,500, Pro ₹30,000. We migrate your current website and data free, you keep your domain, and your data is handed back if you ever leave.</p><p>${LINKS}</p>${CONTACT}`,
  features: `<h1 style="font-size:2.2rem;line-height:1.15;margin:0 0 12px">Everything Sckools does, at a glance</h1>
<p style="font-size:1.1rem;max-width:62ch">Four desks, one system. The front office: Morning Bell (the principal's 7:40 summary), admissions desk, fee counter and fee plans, timetable, exam hall, report cards, certificates, print orders, leave and cover, the website studio, announcements, alumni. The staff room: the attendance register, library counter, cover for an absent teacher, tests and results, assignments, the daily diary, messages, leave. Families: notices, the marked-absent alert, timetable and results at home, the Android family app, fees in the app. Beyond the gate: your website on your own domain, festival skins, enquiry forms, the inter-school events network, the school blog, the jobs board, the gallery, Sckools TV for the reception screen.</p>
<p>Not built yet, and said so: school transport, hostel, biometric devices, SMS.</p>${PLANS}<p>${LINKS}</p>${CONTACT}`,
  start: `<h1 style="font-size:2.2rem;line-height:1.15;margin:0 0 12px">Get Sckools for your school: build your quote</h1>
<p style="font-size:1.1rem;max-width:62ch">Switch on the modules your school needs, tell us your size, and get an exact per-year figure with a callback. You pay only for what is switched on; add a module any day. We move your current website free, you keep your domain, and the first two months of custom features are on us.</p>
${PLANS}<p>${LINKS}</p>${CONTACT}`,
};

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const text = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function applyRoute(html, route) {
  const r = ROUTES[route];
  const url = `https://sckools.com${r.path}`;
  const swaps = [
    [/<title>[^<]*<\/title>/, `<title>${text(r.title)}</title>`],
    [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(r.description)}">`],
    [/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`],
    [/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`],
    [/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(r.title)}">`],
    [/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(r.description)}">`],
    [/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(r.title)}">`],
    [/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(r.description)}">`],
  ];
  let out = html;
  const ssr = /<!--ssr:start-->[\s\S]*?<!--ssr:end-->/;
  if (!ssr.test(out)) throw new Error('site-preview-sync: ssr markers not found in index.html');
  out = out.replace(ssr, () => `<!--ssr:start--><div class="ssr" style="max-width:68rem;margin:0 auto;padding:48px 20px 24px">\n${STATIC[route]}\n</div><!--ssr:end-->`);
  for (const [re, to] of swaps) {
    if (!re.test(out)) throw new Error(`site-preview-sync: ${re} not found in index.html`);
    out = out.replace(re, to);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = readFileSync(resolve(dir, 'index.html'), 'utf8');
  for (const route of Object.keys(ROUTES)) {
    writeFileSync(resolve(dir, `${route}.html`), applyRoute(src, route));
  }
  console.log('site-preview: wrote', Object.keys(ROUTES).map((r) => `${r}.html`).join(', '));
}
