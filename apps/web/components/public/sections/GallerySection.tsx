'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PublicSiteData } from '@/lib/public-api';

export default function GallerySection({
  gallery,
  schoolName,
}: {
  gallery: PublicSiteData['gallery'];
  schoolName: string;
}) {
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
      setLb((cur) => (cur === null ? cur : (cur + dir + gallery.length) % gallery.length));
    },
    [gallery.length],
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

  const open = lb === null ? null : gallery[lb];

  return (
    <section id="gallery" className="max-w-6xl mx-auto px-6 py-20">
      <div className="reveal">
        <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
          Gallery
        </div>
        <h2 className="ps-head text-4xl font-bold mt-3">Life at {schoolName}</h2>
      </div>
      {gallery.length === 0 ? (
        <div className="reveal mt-10 ps-panel p-10 text-center">
          <div className="text-5xl">📷</div>
          <h3 className="ps-head font-bold text-lg mt-4">Photos coming soon</h3>
          <p className="text-sm text-slate-500 mt-1">Moments from campus life will appear here.</p>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          {gallery.map((img, i) => (
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
                src={img.url}
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

          {gallery.length > 1 && (
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
              src={open.url}
              alt={open.caption ?? `${schoolName} gallery photo`}
              className="max-h-[82vh] max-w-full ps-panel-sm object-contain"
            />
            {(open.caption || gallery.length > 1) && (
              <figcaption className="mt-3 flex items-baseline justify-between gap-4 text-sm text-white/85">
                <span>{open.caption}</span>
                {gallery.length > 1 && (
                  <span className="tabular-nums text-white/55">
                    {(lb ?? 0) + 1} / {gallery.length}
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
