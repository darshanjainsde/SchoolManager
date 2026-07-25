import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlatformHost, schoolHref } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { fetchGlobalPost, fetchSchoolPost, type BlogPostFull } from '@/lib/blog-api';
import { fetchPublicSite } from '@/lib/public-api';
import PlatformBlogNav from '@/components/blog/PlatformBlogNav';
import BlogBlocks from '@/components/blog/BlogBlocks';
import '@/components/blog/blog.css';

// TODO(next15): params type → Promise<{ slug: string }>
interface Props { params: { slug: string } }

/** Static assets (hero art) are served as root-relative paths from every host of this deployment. */
function absoluteUrl(origin: string, url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('http') ? url : `${origin}${url}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const host = await getRequestHost();

  if (isPlatformHost(host)) {
    const post = await fetchGlobalPost(slug);
    if (!post) return {};
    const url = `https://sckools.com/blog/${post.slug}`;
    const image = absoluteUrl('https://sckools.com', post.heroImageUrl) ?? 'https://sckools.com/og.png';
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
        publishedTime: post.publishedAt ?? undefined,
        images: [{ url: image, width: 1200, height: 630, alt: post.title }],
      },
      twitter: { card: 'summary_large_image', title: post.title, images: [image] },
    };
  }

  // Tenant host — school-appropriate metadata, never platform strings.
  const [post, site] = await Promise.all([fetchSchoolPost(host, slug), fetchPublicSite(host)]);
  if (!post) return {};
  const name = site?.school.name ?? host;
  const tenantOrigin = schoolHref(host);
  const image = absoluteUrl(tenantOrigin, post.heroImageUrl);
  return {
    title: `${post.title} | ${name}`,
    description: post.description,
    // Duplicate-content protection: canonical always comes from the API —
    // it points at the global URL for syndicated/global posts and at this
    // tenant's own URL only for posts that are genuinely unique to it.
    alternates: { canonical: post.canonicalUrl },
    metadataBase: new URL(tenantOrigin),
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

function ArticleBody({ post }: { post: BlogPostFull }) {
  const meta = `${formatDate(post.publishedAt)} · ${post.readMinutes} min read`;
  const byline = post.author && (
    <p className="blog-byline">
      By <a href={schoolHref(post.author.host)}>{post.author.name}</a>
    </p>
  );
  return (
    <article className="blog-article">
      <div className="wrap" style={{ maxWidth: 760 }}>
        {post.heroImageUrl ? (
          // Title overlaid on the hero with a gradient scrim: the branded art is
          // dark, so on a dark page it would otherwise read as an empty void —
          // filling it with the headline makes it an intentional banner instead.
          <header className="blog-hero-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.heroImageUrl} alt="" width={1600} height={800} />
            <div className="blog-hero-cover-text">
              <span className="blog-meta">{meta}</span>
              <h1>{post.title}</h1>
              {byline}
            </div>
          </header>
        ) : (
          <header className="blog-article-head">
            <span className="blog-meta">{meta}</span>
            <h1>{post.title}</h1>
            {byline}
          </header>
        )}
        <BlogBlocks blocks={post.sections} />
      </div>
    </article>
  );
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const host = await getRequestHost();

  if (isPlatformHost(host)) {
    const post = await fetchGlobalPost(slug);
    if (!post) notFound();

    const image = absoluteUrl('https://sckools.com', post.heroImageUrl) ?? 'https://sckools.com/og.png';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt ?? undefined,
      dateModified: post.publishedAt ?? undefined,
      image,
      author: post.author
        ? { '@type': 'Organization', name: post.author.name, url: schoolHref(post.author.host) }
        : { '@type': 'Organization', name: 'Sckools', url: 'https://sckools.com' },
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
        <PlatformBlogNav variant="post" />
        <div className="blog">
          <ArticleBody post={post} />
          <div className="wrap" style={{ maxWidth: 760 }}>
            <p className="blog-cta">
              Want the whole checklist handled for you? See <a href="/school-website-builder">how Sckools builds school websites</a> or
              jump straight to <a href="/pricing">plans &amp; pricing</a>.
            </p>
          </div>
        </div>
      </>
    );
  }

  const [post, site] = await Promise.all([fetchSchoolPost(host, slug), fetchPublicSite(host)]);
  if (!post) notFound();

  // Own-authored posts come back with author: null (the API only attributes
  // syndicated global content) — fall back to the viewing school itself so
  // JSON-LD authorship is never wrong, without adding a redundant "by us"
  // byline to the visible article (that stays keyed on post.author only).
  const jsonLdAuthorName = post.author?.name ?? site?.school.name;
  const jsonLdAuthorHost = post.author?.host ?? host;
  const jsonLdImage = absoluteUrl(schoolHref(host), post.heroImageUrl);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.publishedAt ?? undefined,
    ...(jsonLdImage ? { image: jsonLdImage } : {}),
    ...(jsonLdAuthorName
      ? { author: { '@type': 'Organization', name: jsonLdAuthorName, url: schoolHref(jsonLdAuthorHost) } }
      : {}),
    mainEntityOfPage: post.canonicalUrl,
  };

  return (
    <div className="blog">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="blog-topbar">
        <a href="/"><b>← Home</b></a>
        <div className="blog-topbar-spacer" />
        <a href="/blog">Blog</a>
      </div>
      <ArticleBody post={post} />
    </div>
  );
}
