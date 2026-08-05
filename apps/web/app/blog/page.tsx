import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { fetchGlobalBlog, fetchSchoolBlog } from '@/lib/blog-api';
import { fetchPublicSite } from '@/lib/public-api';
import SchoolChrome from '@/components/public/SchoolChrome';
import PlatformBlogNav from '@/components/blog/PlatformBlogNav';
import BlogIndexList from '@/components/blog/BlogIndexList';
import '@/components/blog/blog.css';

export async function generateMetadata(): Promise<Metadata> {
  const host = await getRequestHost();

  if (isPlatformHost(host)) {
    return {
      title: 'Sckools Blog — School Websites, Admissions & Growth',
      description:
        'Practical guides for school leaders: building a school website, running admissions online, and putting your school on a bigger stage.',
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
  }

  // Tenant host — school-appropriate metadata, never platform strings.
  const site = await fetchPublicSite(host);
  const name = site?.school.name ?? host;
  return {
    title: `Blog | ${name}`,
    description: `The latest posts from ${name}.`,
  };
}

export default async function BlogIndexPage() {
  const host = await getRequestHost();

  if (isPlatformHost(host)) {
    const data = await fetchGlobalBlog();
    const posts = (data?.posts ?? []).map((p, i) => ({ ...p, isHero: i === 0 }));
    return (
      <>
        <PlatformBlogNav variant="index" />
        <div className="blog">
          <div className="wrap">
            <header className="blog-head">
              <span className="blog-eyebrow">Sckools blog</span>
              <h1>Guides for school leaders.</h1>
            </header>
            <BlogIndexList posts={posts} layout="HERO_GRID" />
          </div>
        </div>
      </>
    );
  }

  // Both in parallel: the posts, and the school identity the page wears.
  const [data, site] = await Promise.all([fetchSchoolBlog(host), fetchPublicSite(host)]);
  if (!data || !site) notFound();

  // The school's own chrome, not a bare "← Home" bar: a parent arriving from a
  // newsletter link has to land somewhere that is recognisably this school,
  // with the same way back into the site as every other page.
  return (
    <SchoolChrome data={site}>
      <div className="blog max-w-6xl mx-auto px-6 py-14">
        <header className="blog-head reveal">
          <span className="blog-eyebrow" style={{ color: 'var(--ps1)' }}>
            Blog
          </span>
          <h1 className="ps-head">
            <span className="ps-accent-mark">Latest posts</span>
          </h1>
        </header>
        <BlogIndexList posts={data.posts} layout={data.layout} />
      </div>
    </SchoolChrome>
  );
}
