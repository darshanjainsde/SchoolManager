import { Fragment } from 'react';
import { normalizePageBlocks, type BlockAlign, type PageBlock } from '../site-variants';
import { parseRichText, type Span } from '../page-text';
import { optimised } from '@/lib/img';

/**
 * Renderer for an admin-built page's typed blocks. The block set is CLOSED on
 * purpose: every block maps to the same primitives the rest of the site is
 * drawn with (.ps-head, .ps-panel, the accent), so a custom page wears the
 * school's theme — and its festival, shape and section CSS — automatically,
 * and there is no way for an admin to break out of it.
 *
 * blocks arrive as Json from the api and are re-normalized here: the renderer
 * trusts the type system, never the database.
 *
 * In 2026-10 the blocks gained OPTIONS rather than the set gaining freedom —
 * alignment, heading level, image fit and width, a style on a button — plus
 * five arrangements a school kept asking for (divider, quote, callout, file,
 * table). Every option is optional and every default is the old behaviour, so
 * a page written before this renders byte for byte as it did.
 */

/** Alignment is a class, not an inline style, so a theme can override it. */
const ALIGN_CLASS: Record<BlockAlign, string> = {
  LEFT: '',
  CENTER: 'ps-pg-center',
  RIGHT: 'ps-pg-right',
};
const alignOf = (a?: BlockAlign) => (a ? ALIGN_CLASS[a] : '');

/** A picture painted at most 1200px wide in the column, or the full bleed. */
const IMAGE_REQUEST: Record<string, number> = { COLUMN: 800, WIDE: 1200, FULL: 1920 };

function Marks({ spans }: { spans: Span[] }) {
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

/** A paragraph block: the school's typed marks, become elements. */
function RichText({ text }: { text: string }) {
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

function Block({ b, delay }: { b: PageBlock; delay: React.CSSProperties }) {
  switch (b.t) {
    case 'h':
      return b.level === 3 ? (
        <h3 className={`reveal ps-head text-xl font-bold mt-3 first:mt-0 ${alignOf(b.align)}`} style={delay}>
          {b.text}
        </h3>
      ) : (
        <h2 className={`reveal ps-head text-3xl font-bold mt-4 first:mt-0 ${alignOf(b.align)}`} style={delay}>
          <span className="ps-accent-mark">{b.text}</span>
        </h2>
      );

    case 'p':
      return (
        <div className={`reveal ps-pg-text text-slate-600 leading-relaxed ${alignOf(b.align)}`} style={delay}>
          <RichText text={b.text} />
        </div>
      );

    case 'img': {
      const width = b.width ?? 'WIDE';
      const contain = b.fit === 'CONTAIN';
      return (
        <figure
          className={`reveal ps-pg-img ps-pg-img-${width.toLowerCase()} ${alignOf(b.align)}`}
          style={delay}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={optimised(b.url, IMAGE_REQUEST[width] ?? 1200)}
            alt={b.caption ?? ''}
            // CONTAIN shows the whole picture — a poster, a portrait, a
            // scanned circular — where COVER crops it to a band. COVER stays
            // the default because it is what every existing page looks like.
            className={`w-full ps-panel-sm ${contain ? 'ps-pg-img-contain' : 'max-h-[26rem] object-cover'}`}
            loading="lazy"
            decoding="async"
          />
          {b.caption && <figcaption className="text-xs text-slate-500 mt-2">{b.caption}</figcaption>}
        </figure>
      );
    }

    case 'imgtext':
      return (
        <div className={`reveal ps-panel ps-pgblock-imgtext${b.flip ? ' ps-pgblock-flip' : ''}`} style={delay}>
          {b.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={optimised(b.url, 1200)} alt="" className="h-40 w-full object-cover ps-panel-sm" loading="lazy" decoding="async" />
          ) : (
            <div className="h-40 w-full ps-brandgrad ps-panel-sm grid place-items-center text-4xl text-white">🏫</div>
          )}
          <div className="ps-pg-text text-slate-600 leading-relaxed">
            <RichText text={b.text} />
          </div>
        </div>
      );

    case 'cta':
      return (
        <div className={`reveal ${alignOf(b.align)}`} style={delay}>
          <a href={b.href ?? '/contact'} className={b.style === 'GHOST' ? 'ps-cta ps-cta-ghost' : 'btn-glow ps-cta ps-cta-1'}>
            {b.label}
          </a>
        </div>
      );

    case 'divider':
      return (
        <div
          className={`ps-pg-div ps-pg-div-${(b.style ?? 'RULE').toLowerCase()}`}
          style={delay}
          role="separator"
          aria-hidden="true"
        />
      );

    case 'quote':
      return (
        <figure className="reveal ps-pg-quote" style={delay}>
          <blockquote>
            <RichText text={b.text} />
          </blockquote>
          {b.by && <figcaption>{b.by}</figcaption>}
        </figure>
      );

    case 'callout':
      return (
        <div className={`reveal ps-pg-callout ps-pg-callout-${(b.tone ?? 'NOTE').toLowerCase()}`} style={delay}>
          <span className="ps-pg-callout-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              {b.tone === 'GOOD' ? <path d="m8 12 3 3 5-6" /> : <><path d="M12 8v5" /><path d="M12 16h.01" /></>}
            </svg>
          </span>
          <div className="ps-pg-text">
            <RichText text={b.text} />
          </div>
        </div>
      );

    case 'file':
      return (
        <div className="reveal" style={delay}>
          <a href={b.url} className="ps-pg-file" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3v5h5" />
              <path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z" />
            </svg>
            <span className="ps-pg-file-name">{b.label}</span>
            {b.note && <span className="ps-pg-file-note">{b.note}</span>}
          </a>
        </div>
      );

    case 'table': {
      const [first, ...rest] = b.rows;
      const body = b.header ? rest : b.rows;
      return (
        // Its OWN scroller, so a wide fee table never makes the page scroll
        // sideways — the rule the whole site is held to.
        <div className="reveal ps-pg-tablewrap" style={delay}>
          <table className="ps-pg-table">
            {b.header && first && (
              <thead>
                <tr>
                  {first.map((c, i) => (
                    <th key={i} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      return null;
  }
}

export default function PageBlocks({ blocks }: { blocks: unknown }) {
  const items = normalizePageBlocks(blocks);
  if (items.length === 0) {
    return (
      <div className="ps-panel p-12 text-center">
        <h3 className="ps-head font-bold text-lg">This page is being written</h3>
        <p className="text-sm text-slate-500 mt-1">Its content appears here as the school adds it.</p>
      </div>
    );
  }
  return (
    <div className="ps-pgblocks">
      {items.map((b, i) => (
        <Block key={i} b={b} delay={{ transitionDelay: `${Math.min(i, 6) * 0.06}s` }} />
      ))}
    </div>
  );
}
