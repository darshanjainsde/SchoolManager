'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { isNearWhite, lighten, mix } from './site-utils';
import HeroSection, { heroImagesOf, heroIsPhotoLayout } from './sections/HeroSection';
import SiteNav from './sections/SiteNav';
import CoursesFeatured from './sections/CoursesFeatured';
import AcademicsSection from './sections/AcademicsSection';
import AdmissionsSection, { admissionsHasContent } from './sections/AdmissionsSection';
import HallOfFame, { hofCourses } from './sections/HallOfFame';
import GallerySection from './sections/GallerySection';
import EventsSection from './sections/EventsSection';
import ConnectSection from './sections/ConnectSection';
import { SUBPAGES } from './subpages';
import { PS_CSS } from './ps-css';
import { themeRootProps } from './site-theme';
import ContactSection from './sections/ContactSection';
import FooterSection from './sections/FooterSection';
import FestiveLayer, { FestiveRibbon } from './sections/FestiveLayer';
import PageBlocks from './sections/PageBlocks';
import {
  buildCustomCss,
  normalizeFestiveTheme,
  normalizeSectionVariants,
  sectionGestureClass,
  sectionLayoutClass,
  sectionLayoutOf,
  type SectionKey,
} from './site-variants';

export type SiteView = 'home' | 'academics' | 'admissions' | 'gallery' | 'events' | 'contact' | 'page';

interface Props {
  data: PublicSiteData;
  /** 'home' = full landing page; anything else = a dedicated section page with the same chrome. */
  view?: SiteView;
  /** The admin-built page rendered when view = 'page'. */
  page?: { slug: string; title: string; blocks: unknown };
}


function parseStatValue(val: string): { numeric: boolean; num: number; suffix: string } {
  const clean = val.trim();
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*([%+]?)$/);
  if (match) {
    return { numeric: true, num: Number(match[1]), suffix: match[2] ?? '' };
  }
  return { numeric: false, num: 0, suffix: '' };
}


export default function PublicSite({ data, view = 'home', page }: Props) {
  const onAcademicsPage = view === 'academics';
  // Section anchors live on the homepage; from other pages they need the "/" prefix.
  const base = view !== 'home' ? '/' : '';

  // ── Website-studio config, normalized once ──
  const variants = normalizeSectionVariants(data.profile?.sectionVariants);
  const fest = normalizeFestiveTheme(data.profile?.festiveTheme);
  const customCss = buildCustomCss(data.profile?.customSectionCss);
  const secCls = (key: SectionKey) =>
    [
      sectionLayoutClass(key, sectionLayoutOf(variants, key)),
      sectionGestureClass(variants[key]?.gesture),
    ]
      .filter(Boolean)
      .join(' ');
  const glideOn =
    (data.profile?.scrollFeel ?? 'CLASSIC') === 'GLIDE' &&
    (data.profile?.animationLevel ?? 'FULL') !== 'NONE';

  const brandColor = data.profile?.brandColorPrimary ?? '#2f6b4f';
  // Secondary drives the second gradient stop. If a school leaves it near-white
  // (the default), a lightened tint of the primary reads better than pure white.
  const rawSecondary = data.profile?.brandColorSecondary ?? '#e8b04b';
  const brandColor2 = isNearWhite(rawSecondary) ? lighten(brandColor, 0.4) : rawSecondary;
  const ink = mix(brandColor, '#14261d', 0.55); // deep heading tone derived from primary

  // Theme controls
  const heroPreloadUrl = heroIsPhotoLayout(data) ? heroImagesOf(data)[0] ?? null : null;

  const schoolName = data.school.name;
  const aboutText = data.homepage?.aboutText;
  const hasAbout = !!aboutText;
  // Feature-backed sections are gated on the school's plan entitlements (not on
  // whether content exists yet), so the navbar stays consistent from day one —
  // an enabled-but-empty section renders with an empty state instead of vanishing.
  const hasGallery = data.school.features.includes('GALLERY');
  const hasContact = !!(
    data.profile?.phone ||
    data.profile?.email ||
    data.profile?.addressLine1
  );
  const hasEnquiry = data.school.features.includes('ENQUIRY');
  const hasEvents = data.school.features.includes('EVENTS');
  const hasBlog = data.school.features.includes('BLOG');
  const hasAcademics = data.courses.length > 0;
  const hasAdmissions = admissionsHasContent(data.admissions, data.courses);
  const hasHof = hofCourses(data.courses).length > 0;
  // Admin-controlled homepage visibility; full details always live on the
  // dedicated pages (/admissions, /gallery, /connect, /contact).
  const show = {
    admissions: data.homepage?.showAdmissions ?? true,
    gallery: data.homepage?.showGallery ?? true,
    events: data.homepage?.showEvents ?? true,
    contact: data.homepage?.showContact ?? true,
  };
  // Enquire CTAs anchor to the homepage section when it's shown, else go to /contact.
  const enquireHref = show.contact && (hasContact || hasEnquiry) ? `${base}#enquire` : '/contact';
  const logoUrl = data.profile?.logoUrl;
  const principalName = data.homepage?.principalName;
  const principalMessage = data.homepage?.principalMessage;
  const principalPhotoUrl = data.homepage?.principalPhotoUrl;
  const aboutImageUrl = data.homepage?.aboutImageUrl;

  useEffect(() => {
    // Nav elevate on scroll
    const nav = document.getElementById('ps-nav');
    const handleScroll = () => {
      if (!nav) return;
      nav.classList.toggle('ps-nav-scrolled', window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Reveal on scroll
    const revealObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('in');
            revealObs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));

    // Count-up
    const countObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            const to = Number(el.dataset.to);
            if (isNaN(to)) return;
            const suffix = el.dataset.suffix ?? '';
            let n = 0;
            const step = Math.max(1, Math.round(to / 60));
            const timer = setInterval(() => {
              n += step;
              if (n >= to) {
                n = to;
                clearInterval(timer);
              }
              el.textContent = (to >= 1000 ? n.toLocaleString() : String(n)) + suffix;
            }, 18);
            countObs.unobserve(el);
          }
        });
      },
      { threshold: 0.6 }
    );
    document.querySelectorAll('.count').forEach((el) => countObs.observe(el));

    // Magnetic glow buttons
    const handleMouseMove = (e: MouseEvent) => {
      const b = e.currentTarget as HTMLElement;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--x', `${e.clientX - r.left}px`);
      b.style.setProperty('--y', `${e.clientY - r.top}px`);
    };
    const btns = document.querySelectorAll<HTMLElement>('.btn-glow');
    btns.forEach((b) => b.addEventListener('mousemove', handleMouseMove));

    return () => {
      window.removeEventListener('scroll', handleScroll);
      revealObs.disconnect();
      countObs.disconnect();
      btns.forEach((b) => b.removeEventListener('mousemove', handleMouseMove));
    };
  }, []);

  // ── Scroll feel: GLIDE ──
  // A weighted wheel: input moves a target, the page eases toward it. Wheel
  // only (trackpads and touch keep their native inertia — hijacking those
  // fights the OS), and never under reduced-motion or Animation=Off.
  useEffect(() => {
    if (!glideOn) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let target = window.scrollY;
    let raf = 0;
    let animating = false;
    const maxY = () => document.documentElement.scrollHeight - window.innerHeight;
    const loop = () => {
      const cur = window.scrollY;
      const next = cur + (target - cur) * 0.12;
      if (Math.abs(target - next) < 1) {
        window.scrollTo(0, target);
        animating = false;
        raf = 0;
        return;
      }
      window.scrollTo(0, next);
      raf = requestAnimationFrame(loop);
    };
    const onWheel = (e: WheelEvent) => {
      // Pinch-zoom (ctrl+wheel) and horizontal scrolling stay native.
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      target = Math.max(0, Math.min(maxY(), target + e.deltaY));
      animating = true;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      // Scrollbar drags and keyboard scrolling re-anchor the target.
      if (!animating) target = window.scrollY;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [glideOn]);

  // One definition of what a school looks like, shared with the blog's chrome.
  const themeRoot = themeRootProps(data);

  return (
    <div className={themeRoot.className} style={themeRoot.style}>
      {/* Injected theme CSS */}
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />
      {/* Per-section overrides: sanitized on write, scoped here on render. */}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      {/* Festive decoration layer + greeting strip (palette work lives in
          themeRootProps; removing these removes every trace). */}
      {fest && <FestiveLayer fest={fest} />}
      {fest && <FestiveRibbon fest={fest} />}

      {/* The hero photo is the LCP element and is painted from a CSS
          background, which the browser cannot discover until the stylesheet
          resolves — preload it so the fetch starts with the HTML. React 19
          hoists this into <head>. */}
      {heroPreloadUrl && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="preload" as="image" href={heroPreloadUrl} fetchPriority="high" />
      )}

      {/* ── NAV (style selected by the school admin) ── */}
      <SiteNav
        data={data}
        flags={{ hasAbout, hasAcademics, hasAdmissions, hasHof, hasGallery, hasEvents, hasBlog, hasContact, hasEnquiry }}
        base={base}
        view={view}
        onAcademicsPage={onAcademicsPage}
        enquireHref={enquireHref}
        ink={ink}
      />

      {view !== 'home' ? (
        <>
          {/* ── SUBPAGE BODY (academics / admissions / gallery / events / contact) ── */}
          <section className="max-w-6xl mx-auto px-6 pt-12">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-800 transition">← Back to home</Link>
            {/* THE SUBPAGE MASTHEAD.
                Was a stacked block — eyebrow, headline, paragraph, all left in
                one narrow column — directly above a section that repeated the
                same eyebrow and a second, centred heading. Two headings arguing
                about which one introduces the page.

                Now one masthead, set as an editorial split: the headline holds
                the left, the standfirst sits in its own column against the
                baseline rule, and the section below simply begins. The rule
                draws itself in on entry, so the two halves read as one object
                arriving rather than two blocks stacking. */}
            {SUBPAGES[view] && (
              <div className="ps-masthead reveal mt-6">
                <div className="ps-masthead-eyebrow" style={{ color: 'var(--ps1)' }}>
                  {SUBPAGES[view].eyebrow}
                </div>
                <div className="ps-masthead-split">
                  <h1 className="ps-head ps-masthead-title">
                    {SUBPAGES[view].title.replace('{school}', schoolName)}
                  </h1>
                  <p className="ps-masthead-lede">{SUBPAGES[view].blurb}</p>
                </div>
              </div>
            )}
            {view === 'page' && page && (
              <div className="ps-masthead reveal mt-6">
                <div className="ps-masthead-eyebrow" style={{ color: 'var(--ps1)' }}>
                  {schoolName}
                </div>
                <div className="ps-masthead-split">
                  <h1 className="ps-head ps-masthead-title">{page.title}</h1>
                </div>
              </div>
            )}
          </section>
          {view === 'page' && page && (
            <section data-sec="page" className="max-w-6xl mx-auto px-6 pt-10 pb-16">
              <PageBlocks blocks={page.blocks} />
            </section>
          )}
          {view === 'academics' && <AcademicsSection courses={data.courses} onOwnPage />}
          {view === 'admissions' && (
            // The ONE caller that shows fees. See AdmissionsSection's
            // `showFeeTable` for why it is opt-in rather than opt-out.
            <AdmissionsSection
              admissions={data.admissions}
              courses={data.courses}
              variant="rail"
              showFeeTable
              onOwnPage
            />
          )}
          {view === 'gallery' && <GallerySection gallery={data.gallery} schoolName={schoolName} onOwnPage />}
          {/* The /connect PAGE is the one with the front door on it: joining,
              seats, the waitlist. The home band stays a teaser. */}
          {view === 'events' && (
            <ConnectSection events={data.events} timezone={data.school.timezone} schoolName={schoolName} />
          )}
          {view === 'contact' && (
            <ContactSection
              profile={data.profile}
              socialLinks={data.socialLinks}
              hasEnquiry={hasEnquiry}
              courses={data.courses.map((c) => c.name)}
              schoolName={schoolName}
              onOwnPage
            />
          )}
          {view !== 'contact' && (
            <section className="max-w-6xl mx-auto px-6 py-16 text-center">
              <h2 className="ps-head text-3xl font-bold">Want to know more?</h2>
              <p className="mt-2 text-slate-600">Our admissions team is happy to help with any question.</p>
              <a
                href="/contact"
                className="btn-glow ps-cta-btn inline-block mt-6 font-semibold px-6 py-3.5 rounded-xl ps-soft hover:scale-[1.03] transition"
              >
                Enquire now →
              </a>
            </section>
          )}
        </>
      ) : (
        <>
      {/* ── HERO (layout selected by the school admin) ── */}
      <HeroSection data={data} enquireHref={enquireHref} hasAbout={hasAbout} brandColor2={brandColor2} />

      {/* ── STATS ── */}
      {data.stats.length > 0 && (
        <section
          data-sec="stats"
          className={`ps-stats-grid ${secCls('stats')} max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-6`}
        >
          {data.stats.map((stat, i) => {
            const parsed = parseStatValue(stat.value);
            const rings = sectionLayoutOf(variants, 'stats') === 'RINGS';
            const num = parsed.numeric ? (
              <div
                className={`ps-head font-bold ps-grad-text count ${rings ? 'text-2xl' : 'text-4xl'}`}
                data-to={String(parsed.num)}
                data-suffix={parsed.suffix}
              >
                0
              </div>
            ) : (
              <div className={`ps-head font-bold ps-grad-text ${rings ? 'text-2xl' : 'text-4xl'}`}>{stat.value}</div>
            );
            return (
              <div
                key={i}
                className="ps-statcard reveal ps-card ps-soft rounded-2xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                {rings ? (
                  <div className="ps-ring" style={{ '--ps-ring-p': 68 + ((i * 9) % 30) } as React.CSSProperties}>
                    <span>{num}</span>
                  </div>
                ) : (
                  num
                )}
                <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── ABOUT ── */}
      {hasAbout && (
        <section
          id="about"
          data-sec="about"
          className={`ps-about-grid ${secCls('about')} max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-14 items-center`}
        >
          <div className="ps-about-img-wrap reveal relative">
            <div className="absolute -inset-4 ps-about-glow rounded-3xl" />
            <div className="ps-about-img relative rounded-3xl overflow-hidden h-80 ps-card ps-soft">
              {aboutImageUrl || principalPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(aboutImageUrl ?? principalPhotoUrl)!}
                  alt={aboutImageUrl ? `About ${schoolName}` : principalName ?? 'Principal'}
                  className="w-full h-full object-cover"
                loading="lazy" decoding="async" />
              ) : (
                <div className="w-full h-full ps-brandgrad grid place-items-center text-6xl text-white">🏫</div>
              )}
            </div>
            {principalName && (
              <div className="ps-card ps-soft absolute -bottom-6 -right-4 rounded-2xl p-4 w-56">
                <div className="flex items-center gap-3">
                  {principalPhotoUrl && (
                    <img src={principalPhotoUrl} alt={principalName} className="h-11 w-11 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                  )}
                  <div>
                    <div className="ps-head text-sm font-bold">{principalName}</div>
                    <div className="text-xs text-slate-500">Principal</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="ps-about-copy reveal">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              About
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">
              A community built on <span className="ps-grad-text">care &amp; curiosity</span>
            </h2>
            <p className="mt-5 text-slate-600 leading-relaxed">{aboutText}</p>
            {principalMessage && (
              <blockquote className="mt-5 text-slate-600 italic border-l-2 pl-4 text-sm" style={{ borderColor: brandColor }}>
                &ldquo;{principalMessage}&rdquo;
              </blockquote>
            )}
          </div>
        </section>
      )}

      {/* ── FEATURED COURSES (homepage flip cards) ── */}
      <div data-sec="courses" className={secCls('courses') || undefined}>
        <CoursesFeatured courses={data.courses} />
        {/* Full catalogue lives on its own page now */}
        {hasAcademics && (
          <div className="max-w-6xl mx-auto px-6 -mt-8 pb-14">
            <a href="/academics" className="text-sm font-semibold hover:opacity-80 transition" style={{ color: 'var(--ps1)' }}>
              View all programmes →
            </a>
          </div>
        )}
      </div>

      {/* ── ADMISSIONS (process + fee structure) ── */}
      {hasAdmissions && show.admissions && (
        <div data-sec="admissions" className={secCls('admissions') || undefined}>
          <AdmissionsSection
            admissions={data.admissions}
            courses={data.courses}
            // STEPPER maps to the vertical rail the /admissions page already
            // renders; TILES restyles the journey grid from the stylesheet.
            variant={sectionLayoutOf(variants, 'admissions') === 'STEPPER' ? 'rail' : 'journey'}
          />
        </div>
      )}

      {/* ── GALLERY ── */}
      {hasGallery && show.gallery && (
        <div data-sec="gallery" className={secCls('gallery') || undefined}>
          <GallerySection gallery={data.gallery} schoolName={schoolName} />
        </div>
      )}

      {/* ── HALL OF FAME (class-wise toppers) ── */}
      {hasHof && <HallOfFame courses={data.courses} />}

      {/* ── CONNECT / EVENTS ── */}
      {hasEvents && show.events && <EventsSection events={data.events} timezone={data.school.timezone} />}

      {/* ── EDUCATORS / STAFF ── */}
      {data.staff.length > 0 && (
        <section id="staff" data-sec="staff" className={`${secCls('staff')} max-w-6xl mx-auto px-6 py-20`}>
          <div className="reveal text-center max-w-2xl mx-auto">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              Our people
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">Meet our educators</h2>
          </div>
          <div className="ps-staff-grid mt-12 grid grid-cols-2 md:grid-cols-4 gap-6">
            {data.staff.map((person, i) => (
              <div
                key={i}
                className="ps-staffcard reveal ps-lift ps-card ps-soft rounded-3xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.05}s` }}
              >
                <div className="mx-auto h-20 w-20 rounded-full overflow-hidden ps-logo-bg grid place-items-center text-2xl font-semibold text-white">
                  {person.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={person.photoUrl} alt={person.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    person.name.charAt(0)
                  )}
                </div>
                <div className="ps-head mt-4 font-bold">{person.name}</div>
                <div className="text-sm text-slate-500 mt-0.5">{person.role}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONTACT + ENQUIRY ── */}
      {(hasContact || hasEnquiry) && show.contact && (
        <ContactSection
          profile={data.profile}
          socialLinks={data.socialLinks}
          hasEnquiry={hasEnquiry}
          courses={data.courses.map((c) => c.name)}
          schoolName={schoolName}
        />
      )}
        </>
      )}

      {/* ── CUSTOM HTML BLOCK (operator escape hatch; sanitized on write) ── */}
      {view === 'home' && data.profile?.customHtmlBlock && (
        <section
          data-sec="custom"
          className="reveal max-w-6xl mx-auto px-6 py-14"
          dangerouslySetInnerHTML={{ __html: data.profile.customHtmlBlock }}
        />
      )}

      {/* ── FOOTER (extracted; answers to footerConfig) ── */}
      <FooterSection
        data={data}
        flags={{ hasAbout, hasAcademics, hasAdmissions, hasHof, hasGallery, hasEvents, hasBlog, hasContact, hasEnquiry }}
        base={base}
        year={new Date().getFullYear()}
      />
    </div>
  );
}
