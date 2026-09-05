'use client';

import { useEffect, useState } from 'react';
import { optimised } from '@/lib/img';
import type { PublicSiteData } from '@/lib/public-api';
import { rgba } from '../site-utils';

// Layouts that put text on top of a photo and therefore need images + overlay.
const PHOTO_LAYOUTS = new Set(['FULL_BLEED', 'SPLIT_MOSAIC', 'SPLIT_EDITORIAL', 'COLLAGE', 'SLIDESHOW']);

// A photo hero cycles at most this many images as a background carousel. The
// top slots take priority, so a school can add anywhere from 1 to 10 images and
// the hero stays calm — one still image, several a gentle rotation, more than
// this the leading ones. Keeps a long album from becoming an endless slideshow.
const HERO_SLIDES_MAX = 6;

/** Ordered hero images; falls back to the legacy single heroUrl. */
export function heroImagesOf(data: PublicSiteData): string[] {
  const imgs = data.homepage?.heroImages;
  if (imgs && imgs.length > 0) return imgs;
  return data.homepage?.heroUrl ? [data.homepage.heroUrl] : [];
}

/**
 * Effective layout after fallbacks: old API payloads map through the legacy
 * heroStyle; photo layouts without a single image degrade to the illustrated
 * hero (same downgrade the old PHOTO style had); a one-image slideshow is
 * just a full-bleed.
 */
export function resolveHeroLayout(data: PublicSiteData): string {
  const p = data.profile;
  const declared =
    p?.heroLayout ?? (p?.heroStyle === 'PHOTO' ? 'FULL_BLEED' : (p?.heroStyle ?? 'ILLUSTRATION'));
  const count = heroImagesOf(data).length;
  // A background video stands in for the missing photo: the media IS the
  // full-bleed backdrop, so the no-image downgrade must not fire — but ONLY
  // for a video that can actually render (a real http(s) URL). A half-typed
  // URL must still degrade to the illustrated hero, never a blank band.
  const hasVideo =
    p?.heroMedia === 'VIDEO' && typeof p?.heroVideoUrl === 'string' && /^https?:\/\//i.test(p.heroVideoUrl);
  if (PHOTO_LAYOUTS.has(declared) && count === 0) return hasVideo ? 'FULL_BLEED' : 'ILLUSTRATION';
  if (declared === 'SLIDESHOW' && count === 1) return 'FULL_BLEED';
  return declared;
}

/** Whether the effective layout is photo-based (drives the GHOST navbar). */
export function heroIsPhotoLayout(data: PublicSiteData): boolean {
  return PHOTO_LAYOUTS.has(resolveHeroLayout(data));
}

// ── Overlay between photo and text ──────────────────────────────────────────
// Alphas are calibrated so the default opacity (65) reproduces the paper wash
// the old PHOTO hero shipped with: rgba(paper, .9 / .72 / .3) across 90deg.
const PAPER = '#f7f5ef';
const DARKINK = '#101a14';

function overlayFor(
  style: string,
  opacity: number,
  center: boolean,
  brand: string,
): { background: string; light: boolean } {
  const k = Math.max(10, Math.min(95, opacity)) / 65;
  const a = (base: number) => Math.min(0.96, base * k);
  if (style === 'TINT') {
    return {
      light: true,
      background: center
        ? rgba(brand, a(0.62))
        : `linear-gradient(90deg, ${rgba(brand, a(0.86))} 0%, ${rgba(brand, a(0.58))} 45%, ${rgba(brand, a(0.22))} 100%)`,
    };
  }
  if (style === 'DARK') {
    return {
      light: true,
      background: center
        ? rgba(DARKINK, a(0.58))
        : `linear-gradient(75deg, ${rgba(DARKINK, a(0.8))} 8%, ${rgba(DARKINK, a(0.42))} 55%, ${rgba(DARKINK, a(0.1))} 100%)`,
    };
  }
  // WASH (default) — dark ink text over a paper veil.
  return {
    light: false,
    background: center
      ? rgba(PAPER, Math.min(0.94, 0.78 * k))
      : `linear-gradient(90deg, ${rgba(PAPER, a(0.9))} 0%, ${rgba(PAPER, a(0.72))} 42%, ${rgba(PAPER, a(0.3))} 100%)`,
  };
}

// ── Headline with the selectable accent animation ───────────────────────────
function Headline({
  headline,
  accent,
  light,
  center,
  size = 'text-5xl md:text-6xl',
}: {
  headline: string;
  accent: string;
  light: boolean;
  center: boolean;
  size?: string;
}) {
  return (
    <h1 className={`ps-head ${size} font-bold leading-[1.06] ${light ? 'text-white' : ''}`}>
      {accent === 'MARKER' ? <span className="ps-marker">{headline}</span> : headline}
      {accent === 'DRAW' && (
        <svg
          className={`ps-underline block mt-1 w-56 max-w-full ${center ? 'mx-auto' : ''}`}
          height="14"
          viewBox="0 0 260 14"
          fill="none"
        >
          <path d="M2 10 C 70 2, 190 2, 258 9" stroke="var(--ps2)" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )}
      {accent === 'GROW' && <span className={`ps-accent-grow ${center ? 'mx-auto' : ''}`} />}
    </h1>
  );
}

// ── Shared copy block (chip · headline · sub · CTAs) ────────────────────────
function HeroCopy({
  data,
  enquireHref,
  hasAbout,
  brandColor2,
  accent,
  light,
  center,
  headlineSize,
}: {
  data: PublicSiteData;
  enquireHref: string;
  hasAbout: boolean;
  brandColor2: string;
  accent: string;
  light: boolean;
  center: boolean;
  headlineSize?: string;
}) {
  const headline = data.homepage?.headline ?? data.school.name;
  const subheadline = data.homepage?.subheadline;
  return (
    <div className={center ? 'mx-auto text-center' : ''}>
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold mb-6 ${
          light ? 'bg-white/15 text-white' : 'ps-chip'
        }`}
      >
        <span className="h-2 w-2 rounded-full ps-twinkle" style={{ background: brandColor2 }} />
        Admissions open · 2026–27
      </div>

      <Headline headline={headline} accent={accent} light={light} center={center} size={headlineSize} />

      {subheadline && (
        <p className={`mt-6 text-lg max-w-md ${light ? 'text-white/85' : 'text-slate-600'} ${center ? 'mx-auto' : ''}`}>
          {subheadline}
        </p>
      )}

      <div className={`mt-8 flex flex-wrap items-center gap-3 ${center ? 'justify-center' : ''}`}>
        <a
          href={enquireHref}
          className="btn-glow ps-cta-btn font-semibold px-6 py-3.5 rounded-xl ps-soft hover:scale-[1.03] transition"
        >
          Book a campus visit
        </a>
        {hasAbout && (
          <a
            href="#about"
            className={`px-6 py-3.5 rounded-xl font-semibold border transition ${
              light ? 'border-white/30 hover:bg-white/10 text-white' : 'ps-card hover:bg-black/[.03]'
            }`}
          >
            Explore ↓
          </a>
        )}
      </div>
    </div>
  );
}

// ── Illustrated floating-card cluster (the original hero's right column) ────
function IllustratedCluster({ heroUrl }: { heroUrl: string | null }) {
  return (
    <div className="relative h-[400px] hidden lg:block">
      <div className="ps-float absolute top-2 right-4 w-64 rounded-3xl ps-card ps-soft p-2">
        {heroUrl ? (
          <div className="rounded-2xl h-44 bg-cover bg-center" style={{ backgroundImage: `url('${optimised(heroUrl, 640)}')` }} />
        ) : (
          <div className="rounded-2xl h-44 ps-brandgrad grid place-items-center text-white text-6xl">🏫</div>
        )}
        <div className="p-3 text-sm">
          <b className="ps-head">Open Day</b>
          <div className="text-slate-500 text-xs">Book a visit this term</div>
        </div>
      </div>
      <div className="ps-sway absolute bottom-4 left-2 text-6xl">🎓</div>
      <div className="ps-float ps-d1 absolute bottom-6 right-2 ps-card ps-soft rounded-2xl p-4 flex items-center gap-3">
        <span className="h-11 w-11 rounded-xl ps-accentbg grid place-items-center text-2xl">📚</span>
        <div>
          <b className="ps-head text-sm">Reading club</b>
          <div className="text-xs text-slate-500">every Friday</div>
        </div>
      </div>
      <div className="ps-float ps-d2 absolute top-6 left-8 ps-card ps-soft rounded-2xl p-4 w-44">
        <div className="text-xs text-slate-500">Every child</div>
        <div className="ps-head text-lg font-bold">known by name</div>
      </div>
      <div className="ps-twinkle absolute top-16 left-40 text-3xl">✏️</div>
      <div className="ps-twinkle absolute top-44 left-28 text-2xl" style={{ animationDelay: '-1s' }}>⭐</div>
    </div>
  );
}

// ── Background video (heroMedia=VIDEO) ──────────────────────────────────────
// Muted autoplay loop with the first photo slot as poster. The stylesheet
// hides it under reduced-motion / Animation=Off (.ps-hero-video rules), which
// leaves the poster's sibling photo layer as the fallback — the video is an
// enhancement on top of the image, never a replacement for it.
function HeroVideo({ url, poster }: { url: string; poster: string | null }) {
  return (
    <video
      className="ps-hero-video"
      src={url}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}

/** Whether this payload asks for a background video that can actually play. */
export function heroWantsVideo(data: PublicSiteData): boolean {
  return (
    data.profile?.heroMedia === 'VIDEO' &&
    typeof data.profile?.heroVideoUrl === 'string' &&
    /^https?:\/\//i.test(data.profile.heroVideoUrl)
  );
}

// ── Slideshow (crossfade + Ken Burns, motion-aware) ─────────────────────────
function Slides({ images, motionOff, showDots = true }: { images: string[]; motionOff: boolean; showDots?: boolean }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (motionOff || images.length < 2) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), 6000);
    return () => clearInterval(t);
  }, [images.length, motionOff]);
  return (
    <>
      {images.map((url, i) => (
        <div
          key={i}
          className={`ps-slide ${i === idx ? 'on ps-kb' : ''}`}
          style={{ backgroundImage: `url('${optimised(url, 1920)}')` }}
          aria-hidden="true"
        />
      ))}
      {showDots && images.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[3] flex gap-2">
          {images.map((_, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full transition"
              style={{ background: i === idx ? 'var(--ps2)' : 'rgba(255,255,255,.45)' }}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── The hero section — one renderer per layout ──────────────────────────────
export default function HeroSection({
  data,
  enquireHref,
  hasAbout,
  brandColor2,
}: {
  data: PublicSiteData;
  enquireHref: string;
  hasAbout: boolean;
  brandColor2: string;
}) {
  const layout = resolveHeroLayout(data);
  const images = heroImagesOf(data);
  const heroUrl = images[0] ?? null;
  const brand = data.profile?.brandColorPrimary ?? '#2f6b4f';
  const center = (data.profile?.heroTextAlign ?? 'LEFT') === 'CENTER';
  const ovStyle = data.profile?.heroOverlayStyle ?? 'WASH';
  const ovOpacity = data.profile?.heroOverlayOpacity ?? 65;
  const full = (data.profile?.heroHeight ?? 'FULL') === 'FULL';
  const accent = data.profile?.headlineAccent ?? 'DRAW';
  const motionOff = (data.profile?.animationLevel ?? 'FULL') === 'NONE';
  const overlay = overlayFor(ovStyle, ovOpacity, center, brand);
  // PILL/GHOST navs overlay a photo hero (fixed, no reserved strip), so the
  // hero must fill the whole viewport and pad its content below the bar.
  const navOverlay =
    PHOTO_LAYOUTS.has(layout) && ['PILL', 'GHOST'].includes(data.profile?.navStyle ?? 'CLASSIC');

  const copyProps = { data, enquireHref, hasAbout, brandColor2, accent } as const;

  // ── MINIMAL — pure type, centered (original markup preserved) ──
  if (layout === 'MINIMAL') {
    return (
      <section id="home" className="relative overflow-hidden">
        <div className="relative max-w-3xl mx-auto px-6 py-24 text-center grid grid-cols-1 gap-12 items-center w-full">
          <HeroCopy {...copyProps} light={false} center />
        </div>
      </section>
    );
  }

  // ── ILLUSTRATION — the original default hero, unchanged ──
  if (layout === 'ILLUSTRATION') {
    return (
      <section id="home" className="relative overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-20 grid lg:grid-cols-2 gap-12 items-center w-full">
          <HeroCopy {...copyProps} light={false} center={false} />
          <IllustratedCluster heroUrl={heroUrl} />
        </div>
      </section>
    );
  }

  // ── FULL_BLEED — photo fills the viewport behind the copy ──
  if (layout === 'FULL_BLEED' || layout === 'SLIDESHOW') {
    // A photo hero with more than one image now cycles them as a background
    // carousel (crossfade + Ken Burns), whatever the layout — so the extra
    // images a school uploads earn their place instead of sitting unused. One
    // image stays a calm still; the top HERO_SLIDES_MAX take priority.
    const slidesImages = images.slice(0, HERO_SLIDES_MAX);
    const useSlides = layout === 'SLIDESHOW' || images.length >= 2;
    // The original PHOTO hero kept the illustrated cluster over a left-washed
    // photo; that exact rendering survives as WASH + LEFT on a SINGLE image.
    const legacyWash = images.length < 2 && ovStyle === 'WASH' && !center;
    return (
      <section
        id="home"
        className={`relative overflow-hidden ${
          full ? (navOverlay ? 'min-h-screen' : 'min-h-[calc(100vh-4rem)]') : 'min-h-[70vh]'
        } flex items-center`}
      >
        <div className="absolute inset-0" aria-hidden="true">
          {useSlides ? (
            <Slides images={slidesImages} motionOff={motionOff} />
          ) : heroUrl ? (
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${optimised(heroUrl, 1920)}')` }} />
          ) : (
            // No poster (a video-only hero): a branded backdrop stands behind
            // the video and IS the fallback when the video is hidden for
            // reduced-motion / Animation=Off, instead of a blank washed band.
            <div className="absolute inset-0 ps-brandgrad" />
          )}
          {/* Video sits OVER the photo layer: when the stylesheet hides it
              (reduced-motion, Animation=Off) the photo behind is the render. */}
          {heroWantsVideo(data) && !motionOff && (
            <HeroVideo url={data.profile!.heroVideoUrl as string} poster={heroUrl} />
          )}
          <div className="absolute inset-0" style={{ background: overlay.background }} />
          <div
            className="absolute inset-x-0 bottom-0 h-24"
            style={{ background: 'linear-gradient(180deg, transparent, var(--paper))' }}
          />
        </div>

        <div
          className={`relative max-w-6xl mx-auto px-6 ${navOverlay ? 'pt-28' : 'pt-14'} pb-20 grid ${
            legacyWash ? 'lg:grid-cols-2' : 'grid-cols-1'
          } gap-12 items-center w-full`}
        >
          <HeroCopy {...copyProps} light={overlay.light} center={center} />
          {legacyWash && <IllustratedCluster heroUrl={heroUrl} />}
        </div>
      </section>
    );
  }

  // ── SPLIT_MOSAIC — big image left (headline on it), two small right ──
  if (layout === 'SPLIT_MOSAIC') {
    const smalls = images.slice(1, 3);
    return (
      <section id="home" className="relative overflow-hidden">
        <div className={`max-w-6xl mx-auto px-6 ${navOverlay ? 'pt-24' : 'pt-6'} pb-14 w-full`}>
          <div className={`grid gap-3 ${smalls.length ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
            <div
              className={`reveal relative rounded-3xl overflow-hidden ps-soft flex items-end ${
                full ? 'min-h-[72vh]' : 'min-h-[56vh]'
              }`}
            >
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${optimised(heroUrl, 1920)}')` }} />
              {heroWantsVideo(data) && !motionOff && (
                <HeroVideo url={data.profile!.heroVideoUrl as string} poster={heroUrl} />
              )}
              <div className="absolute inset-0" style={{ background: overlay.background }} />
              <div className={`relative p-8 md:p-12 w-full ${center ? 'text-center' : ''}`}>
                <HeroCopy {...copyProps} light={overlay.light} center={center} headlineSize="text-4xl md:text-5xl" />
              </div>
            </div>
            {smalls.length > 0 && (
              <div className={`grid gap-3 grid-cols-2 lg:grid-cols-1 ${smalls.length === 2 ? 'lg:grid-rows-2' : 'lg:grid-rows-1'}`}>
                {smalls.map((url, i) => (
                  <div
                    key={i}
                    className="reveal rounded-3xl ps-soft ps-tile min-h-[140px]"
                    style={{ backgroundImage: `url('${url}')`, transitionDelay: `${(i + 1) * 0.12}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── SPLIT_EDITORIAL — copy on paper left, full-height photo right ──
  if (layout === 'SPLIT_EDITORIAL') {
    return (
      <section id="home" className="relative overflow-hidden">
        <div
          className={`max-w-6xl mx-auto px-6 ${navOverlay ? 'pt-24' : 'pt-6'} pb-14 grid gap-8 lg:grid-cols-2 items-stretch ${
            full ? 'lg:min-h-[78vh]' : 'lg:min-h-[60vh]'
          }`}
        >
          <div className="flex flex-col justify-center py-10">
            <span className="block h-1.5 w-10 rounded-full mb-7" style={{ background: 'var(--ps2)' }} />
            <HeroCopy {...copyProps} light={false} center={center} />
          </div>
          <div
            className="reveal relative overflow-hidden rounded-3xl ps-soft ps-tile min-h-[320px]"
            style={images.length < 2 ? { backgroundImage: `url('${heroUrl}')` } : undefined}
          >
            {/* Two or more images crossfade in the side panel (dots omitted —
                the panel is a frame, not a gallery); one stays a still. */}
            {images.length >= 2 && (
              <Slides images={images.slice(0, HERO_SLIDES_MAX)} motionOff={motionOff} showDots={false} />
            )}
            {heroWantsVideo(data) && !motionOff && (
              <HeroVideo url={data.profile!.heroVideoUrl as string} poster={heroUrl} />
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── COLLAGE — centered copy over a photo band ──
  const band = images.slice(0, 4);
  const bandCols = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-2 md:grid-cols-3', 'grid-cols-2 md:grid-cols-4'][band.length];
  return (
    <section id="home" className="relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 pt-12 pb-14 w-full">
        <div className="max-w-3xl mx-auto text-center">
          <HeroCopy {...copyProps} light={false} center />
        </div>
        <div className={`mt-12 grid gap-3 ${bandCols}`}>
          {band.map((url, i) => (
            <div
              key={i}
              className={`reveal rounded-3xl ps-soft ps-tile ${full ? 'h-72' : 'h-56'} ${
                i % 2 === 1 ? 'md:translate-y-6' : ''
              }`}
              style={{ backgroundImage: `url('${url}')`, transitionDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
