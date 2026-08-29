'use client';

import { normalizePageBlocks } from '../site-variants';

/**
 * Renderer for an admin-built page's typed blocks. The block set is CLOSED on
 * purpose: every block maps to the same primitives the rest of the site is
 * drawn with (.ps-head, .ps-panel, the accent), so a custom page wears the
 * school's theme — and its festival, shape and section CSS — automatically,
 * and there is no way for an admin to break out of it.
 *
 * blocks arrive as Json from the api and are re-normalized here: the renderer
 * trusts the type system, never the database.
 */
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
      {items.map((b, i) => {
        const delay = { transitionDelay: `${Math.min(i, 6) * 0.06}s` };
        switch (b.t) {
          case 'h':
            return (
              <h2 key={i} className="reveal ps-head text-3xl font-bold mt-4 first:mt-0" style={delay}>
                <span className="ps-accent-mark">{b.text}</span>
              </h2>
            );
          case 'p':
            return (
              <p key={i} className="reveal text-slate-600 leading-relaxed whitespace-pre-line" style={delay}>
                {b.text}
              </p>
            );
          case 'img':
            return (
              <figure key={i} className="reveal" style={delay}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.url}
                  alt={b.caption ?? ''}
                  className="w-full max-h-[26rem] object-cover ps-panel-sm"
                  loading="lazy"
                  decoding="async"
                />
                {b.caption && <figcaption className="text-xs text-slate-500 mt-2">{b.caption}</figcaption>}
              </figure>
            );
          case 'imgtext':
            return (
              <div key={i} className="reveal ps-panel ps-pgblock-imgtext" style={delay}>
                {b.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.url} alt="" className="h-40 w-full object-cover ps-panel-sm" loading="lazy" decoding="async" />
                ) : (
                  <div className="h-40 w-full ps-brandgrad ps-panel-sm grid place-items-center text-4xl text-white">🏫</div>
                )}
                <p className="text-slate-600 leading-relaxed whitespace-pre-line">{b.text}</p>
              </div>
            );
          case 'cta':
            return (
              <div key={i} className="reveal" style={delay}>
                <a
                  href={b.href ?? '/contact'}
                  className="btn-glow ps-cta ps-cta-1"
                >
                  {b.label}
                </a>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
