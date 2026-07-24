import type { BlogBlock } from '@skoolos/db';
import BlogQuiz from './BlogQuiz';

/**
 * Server-rendered block renderer for BlogPost.sections. Everything except the
 * quiz is static markup (good for SEO); quiz interactivity is isolated to the
 * one small client component. Block shape: packages/db/src/blog-blocks.ts.
 */
export default function BlogBlocks({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.t) {
          case 'h':
            return <h2 key={i}>{block.text}</h2>;
          case 'p':
            return <p key={i}>{block.text}</p>;
          case 'ul':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case 'img':
            return (
              <figure className="blog-img" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={block.url} alt={block.alt} width={1600} height={900} loading="lazy" />
                {block.caption && <figcaption>{block.caption}</figcaption>}
              </figure>
            );
          case 'stats':
            return (
              <div className="blog-stats" key={i}>
                {block.items.map((item, j) => (
                  <div
                    key={j}
                    className={
                      item.tone === 'good'
                        ? 'blog-stat blog-stat-good'
                        : item.tone === 'bad'
                          ? 'blog-stat blog-stat-bad'
                          : 'blog-stat'
                    }
                  >
                    <b>{item.value}</b>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            );
          case 'ranking':
            return (
              <div className="blog-rank" key={i} aria-label="Ranking">
                {block.items.map((item, j) => (
                  <div className="blog-rank-row" key={j}>
                    <span>{item.label}</span>
                    <div className="blog-rank-bar">
                      <div className="blog-rank-fill" style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }} />
                    </div>
                    <em>{item.value}</em>
                  </div>
                ))}
                {block.source && <p className="blog-src">{block.source}</p>}
              </div>
            );
          case 'quiz':
            return <BlogQuiz key={i} tag={block.tag} q={block.q} options={block.options} correct={block.correct} why={block.why} />;
          default:
            return null;
        }
      })}
    </>
  );
}
