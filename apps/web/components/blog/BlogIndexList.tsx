import type { BlogCard } from '@/lib/blog-api';

type Card = BlogCard & { isHero?: boolean };

/**
 * Shared index-layout renderer for both the global blog (always HERO_GRID,
 * first post synthetically marked isHero) and tenant blogs (layout + isHero
 * come straight off the /public/blog response).
 */
export default function BlogIndexList({ posts, layout }: { posts: Card[]; layout: 'HERO_GRID' | 'GRID' | 'LIST' }) {
  if (posts.length === 0) {
    return <p className="blog-empty">No posts yet — check back soon.</p>;
  }

  if (layout === 'LIST') {
    return (
      <div className="blog-list">
        {posts.map((p) => (
          <a className="blog-list-row" href={`/blog/${p.slug}`} key={p.slug}>
            {p.heroImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.heroImageUrl} alt={p.title} width={320} height={200} loading="lazy" />
            )}
            <div className="blog-list-body">
              <b>{p.title}</b>
              <p>{p.description}</p>
              <Meta post={p} />
            </div>
          </a>
        ))}
      </div>
    );
  }

  if (layout === 'GRID') {
    return (
      <div className="blog-grid">
        {posts.map((p) => (
          <BlogTile key={p.slug} post={p} />
        ))}
      </div>
    );
  }

  // HERO_GRID
  const heroes = posts.filter((p) => p.isHero);
  const rest = posts.filter((p) => !p.isHero);
  return (
    <div className="blog-hero-grid">
      <div className={`blog-hero-row${heroes.length > 1 ? ' blog-hero-limit-2' : ''}`}>
        {heroes.map((p) => (
          <a className="blog-hero-tile" href={`/blog/${p.slug}`} key={p.slug}>
            {p.heroImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.heroImageUrl} alt={p.title} width={1600} height={800} loading="lazy" />
            )}
            <div className="blog-hero-body">
              <h2>{p.title}</h2>
              <p>{p.description}</p>
              <Meta post={p} />
            </div>
          </a>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="blog-grid">
          {rest.map((p) => (
            <BlogTile key={p.slug} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlogTile({ post }: { post: Card }) {
  return (
    <a className="blog-card" href={`/blog/${post.slug}`}>
      {post.heroImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.heroImageUrl} alt={post.title} width={640} height={360} loading="lazy" />
      )}
      <div className="blog-card-body">
        <b>{post.title}</b>
        <p>{post.description}</p>
        <Meta post={post} />
      </div>
    </a>
  );
}

function Meta({ post }: { post: Card }) {
  return (
    <span className="blog-meta">
      {post.authorName && <span className="blog-badge">By {post.authorName}</span>}
      {post.readMinutes} min read
    </span>
  );
}
