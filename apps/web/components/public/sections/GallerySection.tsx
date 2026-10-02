'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PublicSiteData } from '@/lib/public-api';
import { galleryGrid } from '../site-variants';
import { optimised } from '@/lib/img';

/**
 * A grid tile is painted at most ~264px wide (four columns inside a 1152px
 * page) and ~170px on a phone; twice that is plenty on a dense screen. The
 * lightbox fills up to 92vw, so it asks for a real width.
 *
 * This section was the ONLY one painting school photos that never went
 * through the optimiser — Academics, Courses, Connect, Alumni, Birthdays and
 * the footer all do. A school's 4MB phone photo was being sent whole into a
 * thumbnail.
 */
const TILE_WIDTH = 640;
const LIGHTBOX_WIDTH = 1920;

export default function GallerySection({
  gallery,
  schoolName,
  onOwnPage,
  limit,
  layout,
}: {
  gallery: PublicSiteData['gallery'];
  schoolName: string;
  /** True when this section IS /gallery: the masthead already introduced it. */
  onOwnPage?: boolean;
  /**
   * How many to show. Undefined on /gallery, where every photo belongs.
   * On the homepage this is the whole point: see site-variants.ts.
   */
  limit?: number;
  /** The arrangement this band is set to — it decides the column count. */
  layout?: string;
}) {
  // What this section actually paints — and what the lightbox steps through,
  // so "3 / 8" on the homepage counts the eight a visitor can see rather than
  // the three hundred they cannot.
  const shown = useMemo(() => (limit === undefined ? gallery : gallery.slice(0, limit)), [gallery, limit]);
  const hiddenCount = gallery.length - shown.length;
  // Only the homepage band gets a chosen width: its count comes from a short
  // list, so a width that divides it always exists. /gallery is an album of
  // any length — no width tiles 37 photos — so it keeps the four-wide grid.
  const grid = limit === undefined ? null : galleryGrid(shown.length, layout ?? 'GRID');
  // Lightbox: index of the open image, with a short closing phase so the
  // exit animation can play before unmount.
  const [lb, setLb] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setLb(null);
      setClosing(false);
    }, 200);
  }, []);

  const step = useCallback(
    (dir: -1 | 1) => {
      setLb((cur) => (cur === null ? cur : (cur + dir + shown.length) % shown.length));
    },
    [shown.length],
  );

  // Keyboard: Esc closes, arrows navigate. Lock page scroll while open.
  useEffect(() => {
    if (lb === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lb, close, step]);

  const open = lb === null ? null : shown[lb];

  return (
    <section id="gallery" className="max-w-6xl mx-auto px-6 py-20">
      {!onOwnPage && (
        <div className="reveal">
          <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
            Gallery
          </div>
          <h2 className="ps-head text-4xl font-bold mt-3">
            <span className="ps-accent-mark">Life at {schoolName}</span>
          </h2>
        </div>
      )}
      {gallery.length === 0 ? (
        <div className="reveal mt-10 ps-panel p-12 text-center">
          {/* Drawn, not shrugged. An emoji says "nothing here"; this says what
              will be here and who it is for. */}
          <svg viewBox="0 0 120 84" className="mx-auto h-24 w-32" fill="none" aria-hidden="true">
            <rect x="10" y="16" width="100" height="60" rx="10" stroke="var(--ps1)" strokeWidth="2.5" opacity=".35" />
            <path d="M10 60l24-20 18 14 16-12 22 18" stroke="var(--ps1)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
            <circle cx="82" cy="34" r="6" fill="var(--ps2)" opacity=".45" />
            <path d="M46 8h28l-6 8H52z" stroke="var(--ps1)" strokeWidth="2.5" strokeLinejoin="round" opacity=".35" />
          </svg>
          <h3 className="ps-head font-bold text-lg mt-5">No photos yet</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Sports days, concerts and classroom moments appear here as {schoolName} adds them.
          </p>
        </div>
      ) : (
        <div
          className="ps-gallery-grid mt-10 grid grid-cols-2 gap-4"
          data-feature={grid ? String(grid.feature) : undefined}
          style={grid ? ({ '--ps-gal-cols': grid.columns } as CSSProperties) : undefined}
        >
          {shown.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setLb(i)}
              aria-label={`View ${img.caption ?? `photo ${i + 1}`} full size`}
              className="reveal group relative overflow-hidden ps-panel ps-panel-sm cursor-zoom-in text-left p-0"
              style={{ transitionDelay: `${i * 0.05}s` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={optimised(img.url, TILE_WIDTH)}
                alt={img.caption ?? `${schoolName} gallery ${i + 1}`}
                className="h-48 w-full object-cover transition duration-500 group-hover:scale-105"
              loading="lazy" decoding="async" />
              {img.caption && (
                <>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#14261d]/75 to-transparent opacity-0 group-hover:opacity-100 transition" />
                  <div className="absolute bottom-3 left-3 text-sm font-medium text-white opacity-0 group-hover:opacity-100 transition">
                    {img.caption}
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* The way to the rest. Only when there IS a rest — a school with six
          photos is not sent to a page that shows the same six. */}
      {hiddenCount > 0 && (
        <div className="reveal mt-7 flex justify-center">
          <Link href="/gallery" className="ps-gal-more">
            See all {gallery.length} photos
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* ── Lightbox ── */}
      {open && (
        <div
          className={`ps-lb${closing ? ' ps-lb-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={open.caption ?? 'Expanded gallery image'}
          onClick={(e) => {
            // Backdrop click closes; clicks on the image/controls don't.
            if (e.target === e.currentTarget) close();
          }}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close image"
            className="absolute top-4 right-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>

          {shown.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* key re-triggers the zoom animation when stepping between photos */}
          <figure key={lb} className="ps-lb-img max-w-[92vw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={optimised(open.url, LIGHTBOX_WIDTH)}
              alt={open.caption ?? `${schoolName} gallery photo`}
              className="max-h-[82vh] max-w-full ps-panel-sm object-contain"
            />
            {(open.caption || shown.length > 1) && (
              <figcaption className="mt-3 flex items-baseline justify-between gap-4 text-sm text-white/85">
                <span>{open.caption}</span>
                {shown.length > 1 && (
                  <span className="tabular-nums text-white/55">
                    {(lb ?? 0) + 1} / {shown.length}
                  </span>
                )}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </section>
  );
}
