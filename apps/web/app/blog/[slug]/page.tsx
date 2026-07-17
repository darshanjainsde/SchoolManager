import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { getPost } from '@/lib/blog';
import '@/components/marketing/marketing.css';

interface Props { params: { slug: string } }

export function generateMetadata({ params }: Props): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};
  const url = `https://sckools.com/blog/${post.slug}`;
  return {
    title: `${post.title} | Sckools`,
    description: post.description,
    alternates: { canonical: url },
    metadataBase: new URL('https://sckools.com'),
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      siteName: 'Sckools',
      type: 'article',
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: post.title }],
    },
    twitter: { card: 'summary_large_image', title: post.title, images: ['/og.png'] },
  };
}

export default function BlogPostPage({ params }: Props) {
  const host = headers().get('host') ?? '';
  if (!isPlatformHost(host)) notFound();
  const post = getPost(params.slug);
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    image: 'https://sckools.com/og.png',
    author: { '@type': 'Organization', name: 'Sckools', url: 'https://sckools.com' },
    publisher: {
      '@type': 'Organization',
      name: 'Sckools',
      logo: { '@type': 'ImageObject', url: 'https://sckools.com/icon-512.png' },
    },
    mainEntityOfPage: `https://sckools.com/blog/${post.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <a href="/" className="logo"><SckoolsLogo size={32} /></a>
          <a className="lnk" href="/blog">Blog</a>
          <a className="lnk" href="/pricing">Pricing</a>
        </div>
      </nav>
      <article className="post">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <span className="post-meta">{post.datePublished} · {post.readMinutes} min read</span>
          <h1 className="h-lg" style={{ marginTop: 10 }}>{post.title}</h1>
          {post.sections.map((s, i) => (
            <section key={i}>
              {s.h && <h2>{s.h}</h2>}
              {s.p?.map((para, j) => <p key={j}>{para}</p>)}
              {s.ul && <ul>{s.ul.map((li, j) => <li key={j}>{li}</li>)}</ul>}
            </section>
          ))}
          <p className="post-cta">
            Want the whole checklist handled for you? See <a href="/school-website-builder">how Sckools builds school websites</a> or
            jump straight to <a href="/pricing">plans &amp; pricing</a>.
          </p>
        </div>
      </article>
      </div>
    </>
  );
}
