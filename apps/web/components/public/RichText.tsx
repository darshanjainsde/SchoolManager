import { Fragment } from 'react';
import { parseRichText, type Span } from './page-text';

/**
 * The school's typed text, as elements: paragraphs, bullet and numbered lists,
 * **bold**, *italic* and [links](/contact). The grammar lives in page-text.ts
 * (plain strings in, never HTML); this is its one renderer, shared by the page
 * builder's text blocks and the admission steps so the two cannot drift.
 *
 * Wrap it in `.ps-pg-text` for the paragraph rhythm and list markers.
 */
export function Marks({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        // The order wraps bold outside italic, so **_both_** reads as one word.
        let node: React.ReactNode = s.text;
        if (s.italic) node = <em key="i">{node}</em>;
        if (s.bold) node = <strong key="b">{node}</strong>;
        if (s.href) {
          const external = /^https?:/i.test(s.href);
          node = (
            <a
              href={s.href}
              className="ps-pg-link"
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

export function RichText({ text }: { text: string }) {
  const lines = parseRichText(text);
  return (
    <>
      {lines.map((l, i) => {
        if (l.kind === 'ul') {
          return (
            <ul key={i} className="ps-pg-list">
              {l.items.map((item, j) => (
                <li key={j}>
                  <Marks spans={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (l.kind === 'ol') {
          return (
            <ol key={i} className="ps-pg-list ps-pg-list-num">
              {l.items.map((item, j) => (
                <li key={j}>
                  <Marks spans={item} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          // `whitespace-pre-line` keeps the single newlines a school typed, as
          // it did before the marks existed.
          <p key={i} className="whitespace-pre-line">
            <Marks spans={l.spans} />
          </p>
        );
      })}
    </>
  );
}
