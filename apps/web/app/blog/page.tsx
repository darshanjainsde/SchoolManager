import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import { fetchGlobalBlog, fetchSchoolBlog } from '@/lib/blog-api';
import { fetchPublicSite } from '@/lib/public-api';
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

  const data = await fetchSchoolBlog(host);
  if (!data) notFound();

  return (
    <div className="blog">
      <div className="blog-topbar">
        <Link href="/"><b>← Home</b></Link>
        <div className="blog-topbar-spacer" />
        <Link href="/blog">Blog</Link>
      </div>
      <div className="wrap">
        <header className="blog-head">
          <span className="blog-eyebrow">Blog</span>
          <h1>Latest posts</h1>
        </header>
        <BlogIndexList posts={data.posts} layout={data.layout} />
      </div>
    </div>
  );
}
