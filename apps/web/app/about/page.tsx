import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { fetchMarketingConfig } from '@/lib/public-api';
import PlatformBlogNav from '@/components/blog/PlatformBlogNav';
import '@/components/marketing/marketing.css';

export const metadata: Metadata = {
  title: 'About Sckools — Who Builds It, How to Reach Us',
  description:
    'Sckools is school management software, a school website and a family app built in India for Indian schools. Who is behind it, what we promise every school, and how to reach a person.',
  alternates: { canonical: 'https://sckools.com/about' },
  metadataBase: new URL('https://sckools.com'),
  openGraph: {
    title: 'About Sckools',
    description: 'Who builds Sckools, what we promise every school, and how to reach a person.',
    url: 'https://sckools.com/about',
    siteName: 'Sckools',
    type: 'website',
    locale: 'en_IN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools' }],
  },
};

/**
 * The page a school management committee looks for before it hands over
 * children's records: who are you, where are you, how do we reach you, what
 * happens to our data. Until this page existed /about and /contact were 404s
 * and the only answer was an email address in the footer.
 *
 * Every sentence here is one the product already keeps (the service promises
 * on the homepage, the controller/processor split in the privacy policy).
 * Nothing is added that a sales call could not repeat.
 */
const PROMISES = [
  { t: 'We move your current website and your data, free', d: 'Students, classes, staff and fee heads come across from your ERP’s export. Your current website stays up until the new one is live.' },
  { t: 'You keep your domain and your branding', d: 'The site goes live on the address parents already know. Zero downtime on the switch.' },
  { t: 'One price per student, per year', d: 'Hosting, your domain, updates every month and support are included. No per-teacher seats, no SMS packs, no add-on invoices.' },
  { t: 'Two months of custom features, on us', d: 'During your first two months we build the small changes your office asks for, at no charge.' },
  { t: 'Your data is yours', d: 'A standard database, nothing proprietary. If you ever leave, we hand it back.' },
  { t: 'Real people on the phone', d: 'We onboard your office on a call and stay on the phone through the first week.' },
];

export default async function AboutPage() {
  const host = await getRequestHost();
  if (!isPlatformHost(host)) notFound();
  const cfg = await fetchMarketingConfig();
  const phone = cfg.contactPhone || '+91 95994 43324';
  const email = cfg.contactEmail || 'admin@sckools.com';

  return (
    <>
      <PlatformBlogNav variant="about" />
      <div className="mkt">
        <header className="lp-hero">
          <div className="wrap">
            <span className="eyebrow">About Sckools</span>
            <h1 className="h-lg lp-h1">Built for schools. Only for schools.</h1>
            <p className="lede">
              Sckools is a school website, school management software (what most vendors call an ERP) and a family
              app, in one login. It is built and supported in India by a small team led by Darshan Jain, and it is
              priced per student so a 300-student school and a 1,500-student school both pay a fair number.
            </p>
          </div>
        </header>

        <section className="lp-sec" aria-label="What we promise">
          <div className="wrap">
            <h2 className="h-lg">What every school gets from us</h2>
            <div className="lp-grid">
              {PROMISES.map((p) => (
                <div className="lp-card" key={p.t}><b>{p.t}</b><p>{p.d}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-sec alt" aria-label="Your data" id="data">
          <div className="wrap" style={{ maxWidth: 820 }}>
            <h2 className="h-lg">Children’s data, handled the way the law now expects</h2>
            <p className="lede" style={{ marginTop: 14 }}>
              Your school is the data controller; Sckools is its processor and acts only on the school’s
              instructions. Each school’s data is isolated, access is role-locked, and a student only ever sees
              their own record. The <a href="/privacy">privacy policy</a> says exactly what is collected and why, in
              plain words, and the <a href="/terms">terms</a> say what happens to the data if a school leaves.
            </p>
          </div>
        </section>

        <section className="lp-sec" aria-label="Contact" id="contact">
          <div className="wrap" style={{ maxWidth: 820 }}>
            <h2 className="h-lg">Reach a person</h2>
            <p className="lede" style={{ marginTop: 14 }}>
              Call <a href={`tel:${phone.replace(/\s+/g, '')}`}>{phone}</a> or write to{' '}
              <a href={`mailto:${email}`}>{email}</a>. A real person calls back within one working day and shows you
              Sckools on your own school, live.
            </p>
            <p className="lede">
              <Link className="lp-cta" href="/#callback">Request a callback</Link>{' '}
              <a className="lp-cta ghost" href="/start">Build your quote</a>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
