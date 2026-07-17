import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { BLOG_POSTS } from '@/lib/blog';
import '@/components/marketing/marketing.css';

export const metadata: Metadata = {
  title: 'Sckools Blog — School Websites, Admissions & Growth',
  description: 'Practical guides for school leaders: building a school website, running admissions online, and putting your school on a bigger stage.',
  alternates: { canonical: 'https://sckools.com/blog' },
  metadataBase: new URL('https://sckools.com'),
  openGraph: {
    title: 'Sckools Blog',
    description: 'Practical guides for school leaders.',
    url: 'https://sckools.com/blog',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools blog' }],
  },
};

export default function BlogIndexPage() {
  const host = headers().get('host') ?? '';
  if (!isPlatformHost(host)) notFound();

  return (
    <>
      <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <a href="/" className="logo"><SckoolsLogo size={32} /></a>
          <a className="lnk" href="/pricing">Pricing</a>
          <a className="lnk" href="/school-website-builder">Website builder</a>
        </div>
      </nav>
      <header className="lp-hero" style={{ paddingBottom: 40 }}>
        <div className="wrap">
          <span className="eyebrow">Sckools blog</span>
          <h1 className="h-lg">Guides for school leaders.</h1>
        </div>
      </header>
      <section className="lp-sec" aria-label="Articles">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <div className="post-list">
            {BLOG_POSTS.map((p) => (
              <a className="post-card" href={`/blog/${p.slug}`} key={p.slug}>
                <b>{p.title}</b>
                <p>{p.description}</p>
                <span className="post-meta">{p.datePublished} · {p.readMinutes} min read</span>
              </a>
            ))}
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
