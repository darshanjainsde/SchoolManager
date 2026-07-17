import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { LP_FAQ } from '@/components/marketing/lp-faq-data';
import '@/components/marketing/marketing.css';

export const metadata: Metadata = {
  title: 'School Website Builder — Launch Your School’s Website in Days | Sckools',
  description:
    'Build a website for your school without developers. Sckools includes design, hosting, your own domain, an admissions enquiry engine and the inter-school events network — one flat yearly plan.',
  alternates: { canonical: 'https://sckools.com/school-website-builder' },
  metadataBase: new URL('https://sckools.com'),
  openGraph: {
    title: 'School Website Builder | Sckools',
    description: 'A complete school website with admissions and events — live in days, no developers needed.',
    url: 'https://sckools.com/school-website-builder',
    siteName: 'Sckools',
    type: 'website',
    locale: 'en_IN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools school website builder' }],
  },
  twitter: { card: 'summary_large_image', title: 'School Website Builder | Sckools', images: ['/og.png'] },
};

const STEPS = [
  { n: '1', t: 'Tell us about your school', d: 'Name, photos, courses, admissions process, fees — one guided form, done in an afternoon.' },
  { n: '2', t: 'We set your site live', d: 'Your complete website goes up on your own domain with SSL and hosting included. Most schools are live the same week.' },
  { n: '3', t: 'Your staff run it themselves', d: 'Announcements, gallery photos, admissions info, events — all editable from a simple admin. No developer, ever.' },
];

const INCLUDED = [
  { t: 'A complete school website', d: 'Home, courses, gallery, admissions, staff, hall of fame, events and contact — designed, hosted and mobile-perfect from day one.' },
  { t: 'An admissions enquiry engine', d: 'Every enquiry from your website lands in a tracked inbox with statuses. Leads stop dying in email.' },
  { t: 'The inter-school events network', d: 'Publish your fests and competitions to a live feed seen by every Sckools school — and let your students join events at other schools.' },
  { t: 'School management, when you’re ready', d: 'Students, classes, timetables, attendance, assignments, and teacher & student portals on the Pro plan.' },
];

export default function SchoolWebsiteBuilderPage() {
  const host = headers().get('host') ?? '';
  if (!isPlatformHost(host)) notFound();

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'School Website Builder — Sckools',
      url: 'https://sckools.com/school-website-builder',
      description: 'Build a website for your school without developers: design, hosting, domain, admissions and inter-school events included.',
      isPartOf: { '@type': 'WebSite', name: 'Sckools', url: 'https://sckools.com' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: LP_FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Sckools', item: 'https://sckools.com/' },
        { '@type': 'ListItem', position: 2, name: 'School Website Builder', item: 'https://sckools.com/school-website-builder' },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <a href="/" className="logo"><SckoolsLogo size={32} /></a>
          <a className="lnk" href="/pricing">Pricing</a>
          <a className="lnk" href="/blog">Blog</a>
          <a className="btn btn-hot btn-sm" href="/pricing">Get started</a>
        </div>
      </nav>

      <header className="lp-hero">
        <div className="wrap">
          <span className="eyebrow">School website builder</span>
          <h1 className="h-lg lp-h1">Build a website for your school<br />— without hiring anyone.</h1>
          <p className="lede">
            Sckools gives your school a complete, professionally designed website with hosting, your own
            domain, an admissions enquiry engine and a live inter-school events network. One flat yearly
            plan. Live in days.
          </p>
          <div className="lp-actions">
            <a className="lp-cta" href="/pricing">See plans &amp; pricing</a>
            <a className="lp-cta ghost" href="/#feats">See what&rsquo;s included</a>
          </div>
        </div>
      </header>

      <section className="lp-sec" aria-label="What is included">
        <div className="wrap">
          <h2 className="h-lg">Everything a school website needs, built in.</h2>
          <div className="lp-grid">
            {INCLUDED.map((c) => (
              <div className="lp-card" key={c.t}><b>{c.t}</b><p>{c.d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec alt" aria-label="How it works">
        <div className="wrap">
          <h2 className="h-lg">Live in three steps.</h2>
          <div className="lp-grid three">
            {STEPS.map((s) => (
              <div className="lp-card" key={s.n}><span className="lp-n">{s.n}</span><b>{s.t}</b><p>{s.d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec" aria-label="Agency comparison">
        <div className="wrap" style={{ maxWidth: 820 }}>
          <h2 className="h-lg">Why schools pick Sckools over a web agency</h2>
          <p className="lede" style={{ marginTop: 14 }}>
            A web design agency builds your school a brochure, hands over the keys, and charges again every
            time the fee structure changes. Sckools is school infrastructure: the website, the admissions
            pipeline behind it, and a network of schools your students can actually compete with. Updates
            take your office staff two minutes, not two weeks of emailing a developer.
          </p>
        </div>
      </section>

      <section className="lp-sec alt" aria-label="FAQ">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <h2 className="h-lg" style={{ textAlign: 'center' }}>Building a school website — FAQ</h2>
          <div className="faq-list">
            {LP_FAQ.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <p className="lede" style={{ textAlign: 'center', marginTop: 36 }}>
            Ready to see your school on a bigger stage? <a href="/pricing" style={{ fontWeight: 700 }}>Pick a plan</a> or
            request a callback from the <a href="/" style={{ fontWeight: 700 }}>homepage</a>.
          </p>
        </div>
      </section>
      </div>
    </>
  );
}
