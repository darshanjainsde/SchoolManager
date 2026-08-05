'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { isNearWhite, lighten, mix } from './site-utils';
import { fontVars, FONT_STACK } from '@/lib/fonts';
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
import ContactSection from './sections/ContactSection';

export type SiteView = 'home' | 'academics' | 'admissions' | 'gallery' | 'events' | 'contact';

interface Props {
  data: PublicSiteData;
  /** 'home' = full landing page; anything else = a dedicated section page with the same chrome. */
  view?: SiteView;
}

const MOTION_MAP: Record<string, number> = { FULL: 1, SUBTLE: 0.5, NONE: 0 };

function parseStatValue(val: string): { numeric: boolean; num: number; suffix: string } {
  const clean = val.trim();
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*([%+]?)$/);
  if (match) {
    return { numeric: true, num: Number(match[1]), suffix: match[2] ?? '' };
  }
  return { numeric: false, num: 0, suffix: '' };
}

// Static, theme-variable-driven CSS. Colours/font/motion come from CSS vars set
// per-render on the root, so the same stylesheet themes each school.
const PS_CSS = `
  .ps-root { font-family: 'Inter', sans-serif; background: var(--paper); color: #43514a; overflow-x: hidden; min-height: 100vh; }
  .ps-head { font-family: var(--font-head); color: var(--ink); letter-spacing: -.01em; }
  /* This stylesheet loads after Tailwind, so .ps-head's ink color silently beat
     Tailwind's .text-white on dark sections (invisible headings/names on the
     Hall of Fame & Events). Re-assert white when both classes are present. */
  .ps-head.text-white { color: #fff; }

  .ps-soft { box-shadow: 0 22px 48px -24px rgba(28,45,36,.38); }
  .ps-card { background: #fff; border: 1px solid rgba(28,45,36,.07); }
  .ps-chip { background: color-mix(in srgb, var(--ps1) 12%, #fff); color: var(--ps1); }
  .ps-brandbg { background: var(--ps1); }
  .ps-accentbg { background: var(--ps2); }
  .ps-brandgrad { background: linear-gradient(120deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2))); }
  .ps-logo-bg { background: linear-gradient(135deg, var(--ps1), var(--ps2)); }
  .ps-cta-btn { background: var(--ps1); color: #fff; }
  .ps-icon-bg { background: linear-gradient(135deg, var(--ps2), var(--ps1)); }
  .ps-progress-bar { background: linear-gradient(90deg, var(--ps1), var(--ps2)); height: 100%; }

  /* gradient/underline accents */
  .ps-grad-text { background: linear-gradient(100deg,var(--ps1),color-mix(in srgb, var(--ps1) 40%, var(--ps2))); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ps-about-glow { background: linear-gradient(135deg, color-mix(in srgb, var(--ps1) 20%, transparent), color-mix(in srgb, var(--ps2) 20%, transparent)); filter: blur(2rem); }

  /* ── School-themed motion, all scaled by --motion (0..1) ── */
  @keyframes ps-floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(calc(-12px * var(--motion)))} }
  .ps-float { animation: ps-floaty calc(7s / (var(--motion) + .06)) ease-in-out infinite; }
  .ps-d1 { animation-delay: -2.5s; }
  .ps-d2 { animation-delay: -4.5s; }
  @keyframes ps-sway { 0%,100%{transform:rotate(calc(-3deg * var(--motion)))} 50%{transform:rotate(calc(3deg * var(--motion)))} }
  .ps-sway { animation: ps-sway calc(5s / (var(--motion) + .06)) ease-in-out infinite; transform-origin: top center; }
  @keyframes ps-twinkle { 0%,100%{opacity: calc(1 - .65 * var(--motion))} 50%{opacity:1} }
  .ps-twinkle { animation: ps-twinkle calc(3.2s / (var(--motion) + .06)) ease-in-out infinite; }
  @keyframes ps-shine { to { background-position: 200% center; } }


  /* ── SUBPAGE MASTHEAD ────────────────────────────────────────────────────
     An editorial split, not a stack. The headline takes the measure it needs
     and the standfirst sits beside it in its own column, separated by a rule
     that draws itself in — so the masthead reads as one object arriving,
     rather than three left-aligned blocks landing in sequence.

     Derived entirely from --ps1/--ps2, so it wears whatever the school chose. */
  .ps-masthead { max-width: 72rem; }
  .ps-masthead-eyebrow {
    font-size: 12.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
  }
  .ps-masthead-split {
    display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 12px 44px; align-items: end; margin-top: 14px; position: relative; padding-bottom: 26px;
  }
  .ps-masthead-title {
    font-size: clamp(2.1rem, 5.2vw, 3.6rem); font-weight: 700; line-height: 1.02;
    letter-spacing: -.03em; margin: 0; text-wrap: balance;
  }
  .ps-masthead-lede {
    margin: 0 0 .35rem; color: var(--ink-3, #64748b); font-size: 1.02rem; line-height: 1.6;
    /* Hangs off the accent, which ties the standfirst to the school's colour
       without tinting the words themselves. */
    border-left: 2px solid var(--ps2); padding-left: 16px;
  }
  /* The rule under the whole masthead draws from the left on entry. */
  .ps-masthead-split::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: linear-gradient(90deg, var(--ps1), color-mix(in srgb, var(--ps1) 12%, transparent));
    transform: scaleX(0); transform-origin: left;
    transition: transform .9s cubic-bezier(.2,.7,.2,1) .12s;
  }
  .reveal.in .ps-masthead-split::after, .ps-masthead.in .ps-masthead-split::after { transform: scaleX(1); }
  @media (max-width: 760px) {
    .ps-masthead-split { grid-template-columns: 1fr; align-items: start; gap: 16px; }
    .ps-masthead-lede { border-left-width: 2px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ps-masthead-split::after { transition: none; transform: scaleX(1); }
  }
  /* reveal on scroll */
  .reveal { opacity: 0; transform: translateY(calc(26px * var(--motion) + 4px)); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .reveal.in { opacity: 1; transform: none; }

  /* hand-drawn underline draws itself once */
  @keyframes ps-draw { to { stroke-dashoffset: 0; } }
  .ps-underline path { stroke-dasharray: 300; stroke-dashoffset: 300; animation: ps-draw 1.5s ease .35s forwards; }

  /* gentle lift on hover */
  .ps-lift { transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
  .ps-lift:hover { transform: translateY(-6px); box-shadow: 0 30px 60px -28px rgba(28,45,36,.45); }

  /* glow button */
  .btn-glow { position: relative; overflow: hidden; }
  .btn-glow::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120px circle at var(--x,50%) var(--y,50%),rgba(255,255,255,.28),transparent 60%); opacity: 0; transition: opacity .3s; }
  .btn-glow:hover::after { opacity: 1; }

  /* ── Ambient header layer (/connect) ──
     Two blurred brand-coloured drifts. No canvas and no library: two divs and
     one keyframe, scaled by the school's own --motion so a NONE school gets a
     still background rather than a slower one. */
  .ps-amb { position: absolute; border-radius: 9999px; filter: blur(60px); opacity: .28; }
  .ps-amb-1 { width: 42vw; height: 42vw; max-width: 520px; max-height: 520px; top: -14%; left: -6%;
    background: var(--ps1); animation: ps-amb-a calc(21s / (var(--motion) + .06)) ease-in-out infinite; }
  .ps-amb-2 { width: 34vw; height: 34vw; max-width: 420px; max-height: 420px; top: -6%; right: -4%;
    background: var(--ps2); animation: ps-amb-b calc(18s / (var(--motion) + .06)) ease-in-out infinite; }
  @keyframes ps-amb-a { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(4%, 6%, 0); } }
  @keyframes ps-amb-b { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(-5%, 4%, 0); } }
  .ps-motion-off .ps-amb { animation: none; }

  /* ── Nav group menus ──
     The menu is mounted only while open (it is a real button + aria-expanded,
     not a :hover rule), so this styles the open state and animates the entrance
     rather than toggling visibility. */
  .ps-menu-wrap { position: relative; }
  @keyframes ps-menu-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .ps-menu { position: absolute; top: calc(100% + 10px); left: 0;
    width: 340px; max-width: 92vw; background: #fff; border: 1px solid rgba(28,45,36,.10); border-radius: 18px;
    box-shadow: 0 16px 40px -20px rgba(28,45,36,.3); padding: 12px; z-index: 60;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px;
    animation: ps-menu-in .2s cubic-bezier(.2,.7,.2,1); }
  /* caret anchoring the menu to its own tab so it reads as belonging to it */
  .ps-menu::before { content: ""; position: absolute; top: -7px; left: 24px; width: 13px; height: 13px;
    background: #fff; border-left: 1px solid rgba(28,45,36,.10); border-top: 1px solid rgba(28,45,36,.10);
    border-radius: 3px 0 0 0; transform: rotate(45deg); }
  /* Drawer variant: rows expand in place, indented under the group they belong to. */
  .ps-submenu { display: grid; gap: 2px; padding: 2px 0 6px 14px; margin-left: 10px;
    border-left: 2px solid rgba(28,45,36,.10); }

  /* ── Course flip cards ── */
  .ps-flip { perspective: 1200px; height: 340px; cursor: pointer; outline-offset: 4px; }
  .ps-flip-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
    transition: transform .65s cubic-bezier(.2,.7,.2,1); }
  .ps-flipped .ps-flip-inner { transform: rotateY(180deg); }
  .ps-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: 1.5rem; overflow: hidden; display: flex; flex-direction: column; }
  .ps-face-back { transform: rotateY(180deg);
    background: linear-gradient(150deg, var(--ps1), color-mix(in srgb, var(--ps1) 45%, #14261d)); }

  /* ── Headline accent variants (admin-selectable) ── */
  @keyframes ps-marker-sweep { to { background-size: 100% .38em; } }
  .ps-marker { background-image: linear-gradient(0deg, color-mix(in srgb, var(--ps2) 50%, transparent), color-mix(in srgb, var(--ps2) 50%, transparent));
    background-repeat: no-repeat; background-size: 0% .38em; background-position: 0 90%;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    animation: ps-marker-sweep .9s cubic-bezier(.2,.7,.2,1) .4s forwards; }
  @keyframes ps-accent-grow { to { transform: scaleX(1); } }
  .ps-accent-grow { display: block; margin-top: 14px; height: 6px; width: 8rem; border-radius: 999px;
    background: linear-gradient(90deg, var(--ps2), color-mix(in srgb, var(--ps2) 55%, var(--ps1)));
    transform: scaleX(0); transform-origin: left;
    animation: ps-accent-grow .8s cubic-bezier(.2,.7,.2,1) .35s forwards; }
  .ps-accent-grow.mx-auto { transform-origin: center; }

  /* ── Hero photo tiles + slideshow ── */
  .ps-tile { background-size: cover; background-position: center; }
  .ps-slide { position: absolute; inset: 0; background-size: cover; background-position: center;
    opacity: 0; transition: opacity 1.1s ease; }
  .ps-slide.on { opacity: 1; }
  @keyframes ps-kb { from { transform: scale(1); } to { transform: scale(calc(1 + 0.07 * var(--motion))); } }
  .ps-kb { animation: ps-kb 7.5s ease-out forwards; }

  /* ── Navbar variants ── */
  /* Links never break mid-label ("Hall of Fame" stays one line). */
  .ps-nav-link { white-space: nowrap; }
  .ps-nav-strip { background: var(--ink); color: rgba(255,255,255,.85); }

  /* Admin-picked bar colour (applies to classic/center/pill/strip, and to
     ghost's scrolled state). */
  .ps-navc-paper { background: color-mix(in srgb, var(--paper) 85%, transparent); }
  .ps-navc-white { background: rgba(255,255,255,.92); }
  .ps-navc-dark  { background: color-mix(in srgb, var(--ink) 96%, transparent); }
  .ps-navc-brand { background: color-mix(in srgb, var(--ps1) 96%, transparent); }
  /* Dark/brand bars flip text to light. */
  .ps-nav-ondark { border-color: rgba(255,255,255,.08); }
  .ps-nav-ondark nav { color: rgba(255,255,255,.85); }
  .ps-nav-ondark .ps-nav-link:hover { background: rgba(255,255,255,.12); }
  .ps-nav-ondark .ps-nav-name { color: #fff; }

  /* Ghost: fully transparent until scrolled, then the colour class shows. */
  .ps-nav-ghost:not(.ps-nav-scrolled) { background: transparent; }
  .ps-nav-ghost .ps-nav-link { color: rgba(255,255,255,.92); }
  .ps-nav-ghost .ps-nav-link:hover { background: rgba(255,255,255,.14); }
  .ps-nav-ghost .ps-nav-name { color: #fff; }
  /* Ghost with dark text at top (admin "Text on photo" = Dark, or Auto over a
     light paper wash) — white links are invisible on a washed-out photo. */
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-link { color: #475569; }
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-link:hover { background: rgba(0,0,0,.06); }
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-name { color: var(--ink); }
  .ps-nav-ghost.ps-nav-scrolled { backdrop-filter: blur(8px); border-color: rgba(0,0,0,.05); }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-link { color: #475569; }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-link:hover { background: rgba(0,0,0,.05); }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-name { color: var(--ink); }

  /* ── Admissions: journey path (homepage) ── */
  .ps-journey { position: relative; }
  .ps-jline { position: absolute; top: 16px; left: 2%; right: 2%; height: 30px; }
  .ps-jline-mask { width: 0%; height: 100%; overflow: hidden;
    transition: width 1s cubic-bezier(.4,0,.2,1) .1s; }
  .ps-journey.in .ps-jline-mask { width: 100%; }
  .ps-jbadge { position: relative; z-index: 1; display: inline-grid; place-items: center;
    min-width: 34px; height: 34px; border-radius: 999px; padding: 0 10px;
    font-size: 11px; font-weight: 800; letter-spacing: .1em;
    box-shadow: 0 0 0 6px var(--paper);
    transform: scale(0); transition: transform .5s cubic-bezier(.34,1.56,.64,1); }
  .ps-journey.in .ps-jbadge { transform: scale(1); }
  .ps-jbody { opacity: 0; transform: translateY(calc(18px * var(--motion) + 4px)); margin-top: 10px;
    transition: opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
  .ps-journey.in .ps-jbody { opacity: 1; transform: none; }
  .ps-journey.in .ps-jbody:hover { transform: translateY(-6px); box-shadow: 0 30px 60px -28px rgba(28,45,36,.45); }

  /* ── Admissions: timeline rail (/admissions page) ── */
  .ps-rail { position: relative; }
  .ps-rail-line, .ps-rail-fill { position: absolute; top: 8px; bottom: 8px; left: 14px; width: 3px; border-radius: 2px; }
  .ps-rail-line { background: rgba(28,45,36,.1); }
  .ps-rail-fill { background: linear-gradient(180deg, var(--ps1), var(--ps2)); bottom: auto; height: 0;
    transition: height 1.6s cubic-bezier(.4,0,.2,1) .15s; }
  .ps-rail.in .ps-rail-fill { height: calc(100% - 16px); }
  .ps-rstep { position: relative; opacity: 0; transition: opacity .55s ease, transform .55s cubic-bezier(.2,.7,.2,1); }
  .ps-rdot { position: absolute; top: 22px; width: 13px; height: 13px; border-radius: 999px;
    background: var(--ps2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ps1) 25%, transparent); }
  .ps-rail.in .ps-rstep { opacity: 1; transform: none; }
  @media (min-width: 768px) {
    .ps-rail-line, .ps-rail-fill { left: 50%; margin-left: -1.5px; }
    .ps-rstep { width: 46%; }
    .ps-rstep-l { margin-right: auto; transform: translateX(calc(-22px * var(--motion))); }
    .ps-rstep-l .ps-rdot { right: -9.2%; margin-right: -6.5px; }
    .ps-rstep-r { margin-left: auto; transform: translateX(calc(22px * var(--motion))); }
    .ps-rstep-r .ps-rdot { left: -9.2%; margin-left: -6.5px; }
  }
  @media (max-width: 767.98px) {
    .ps-rstep { margin-left: 40px; transform: translateY(calc(14px * var(--motion))); }
    .ps-rstep .ps-rdot { left: -32.5px; }
  }

  /* ── Gallery lightbox ── */
  .ps-lb { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 1.25rem;
    background: rgba(16,26,20,.85); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    animation: ps-lb-fade .25s ease; }
  @keyframes ps-lb-fade { from { opacity: 0; } to { opacity: 1; } }
  .ps-lb-img { animation: ps-lb-zoom .32s cubic-bezier(.2,.7,.2,1); }
  @keyframes ps-lb-zoom { from { opacity: 0; transform: scale(.92) translateY(10px); } to { opacity: 1; transform: none; } }
  .ps-lb-closing { animation: ps-lb-fade .2s ease reverse forwards; }
  .ps-lb-closing .ps-lb-img { animation: ps-lb-zoomout .2s ease forwards; }
  @keyframes ps-lb-zoomout { to { opacity: 0; transform: scale(.94); } }

  /* ── Hall of fame podium rise ── */
  @keyframes ps-rise { to { opacity: 1; transform: none; } }
  .ps-champ { opacity: 0; transform: translateY(26px); animation: ps-rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
  .ps-champ-2 { animation-delay: .18s; }
  .ps-champ-3 { animation-delay: .34s; }

  @media (prefers-reduced-motion: reduce) {
    .ps-root { --motion: 0 !important; }
    .reveal { opacity: 1; transform: none; }
    .ps-underline path { stroke-dashoffset: 0; }
    .ps-flip-inner { transition: none; }
    .ps-menu { animation: none; }
    .ps-amb { animation: none; }
    .ps-champ { animation: none; opacity: 1; transform: none; }
    .ps-marker { animation: none; background-size: 100% .38em; }
    .ps-accent-grow { animation: none; transform: scaleX(1); }
    .ps-slide { transition: none; }
    .ps-kb { animation: none; }
    .ps-lb, .ps-lb-img, .ps-lb-closing, .ps-lb-closing .ps-lb-img { animation: none; }
    .ps-jline-mask, .ps-jbadge, .ps-jbody, .ps-rail-fill, .ps-rstep { transition: none; }
    .ps-jline-mask { width: 100%; }
    .ps-jbadge { transform: scale(1); }
    .ps-jbody, .ps-rstep { opacity: 1; transform: none; }
    .ps-rail-fill { height: calc(100% - 16px); }
  }
  /* Animation level = Off — same statics as reduced-motion, admin-driven. */
  .ps-motion-off .ps-marker { animation: none; background-size: 100% .38em; }
  .ps-motion-off .ps-accent-grow { animation: none; transform: scaleX(1); }
  .ps-motion-off .ps-underline path { animation: none; stroke-dashoffset: 0; }
  .ps-motion-off .ps-kb { animation: none; }
  .ps-motion-off .ps-menu { animation: none; }
  .ps-motion-off .ps-jline-mask, .ps-motion-off .ps-jbadge, .ps-motion-off .ps-jbody,
  .ps-motion-off .ps-rail-fill, .ps-motion-off .ps-rstep { transition: none; }
  .ps-motion-off .ps-jline-mask { width: 100%; }
  .ps-motion-off .ps-jbadge { transform: scale(1); }
  .ps-motion-off .ps-jbody, .ps-motion-off .ps-rstep { opacity: 1; transform: none; }
  .ps-motion-off .ps-rail-fill { height: calc(100% - 16px); }
`;

export default function PublicSite({ data, view = 'home' }: Props) {
  const onAcademicsPage = view === 'academics';
  // Section anchors live on the homepage; from other pages they need the "/" prefix.
  const base = view !== 'home' ? '/' : '';
  const brandColor = data.profile?.brandColorPrimary ?? '#2f6b4f';
  // Secondary drives the second gradient stop. If a school leaves it near-white
  // (the default), a lightened tint of the primary reads better than pure white.
  const rawSecondary = data.profile?.brandColorSecondary ?? '#e8b04b';
  const brandColor2 = isNearWhite(rawSecondary) ? lighten(brandColor, 0.4) : rawSecondary;
  const ink = mix(brandColor, '#14261d', 0.55); // deep heading tone derived from primary

  // Theme controls
  const fontHead = FONT_STACK[data.profile?.headingFont ?? 'INTER'] ?? FONT_STACK.INTER;
  const heroPreloadUrl = heroIsPhotoLayout(data) ? heroImagesOf(data)[0] ?? null : null;
  const motion = MOTION_MAP[data.profile?.animationLevel ?? 'FULL'] ?? 1;
  // Declared layout (before image fallbacks) drives the MINIMAL motion damping,
  // exactly as the legacy heroStyle=MINIMAL did.
  const declaredLayout =
    data.profile?.heroLayout ??
    (data.profile?.heroStyle === 'PHOTO' ? 'FULL_BLEED' : (data.profile?.heroStyle ?? 'ILLUSTRATION'));
  const minimal = declaredLayout === 'MINIMAL';

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

  return (
    <div
      className={`ps-root ${fontVars}${motion === 0 ? ' ps-motion-off' : ''}`}
      style={
        {
          '--ps1': brandColor,
          '--ps2': brandColor2,
          '--ink': ink,
          '--font-head': fontHead,
          '--motion': minimal ? 0.25 : motion,
          '--paper': '#f7f5ef',
        } as React.CSSProperties
      }
    >
      {/* Injected theme CSS */}
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />

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
          </section>
          {view === 'academics' && <AcademicsSection courses={data.courses} onOwnPage />}
          {view === 'admissions' && (
            // The ONE caller that shows fees. See AdmissionsSection's
            // `showFeeTable` for why it is opt-in rather than opt-out.
            <AdmissionsSection
              admissions={data.admissions}
              courses={data.courses}
              variant="rail"
              showFeeTable
            />
          )}
          {view === 'gallery' && <GallerySection gallery={data.gallery} schoolName={schoolName} />}
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
        <section className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-6">
          {data.stats.map((stat, i) => {
            const parsed = parseStatValue(stat.value);
            return (
              <div
                key={i}
                className="reveal ps-card ps-soft rounded-2xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                {parsed.numeric ? (
                  <div
                    className="ps-head text-4xl font-bold ps-grad-text count"
                    data-to={String(parsed.num)}
                    data-suffix={parsed.suffix}
                  >
                    0
                  </div>
                ) : (
                  <div className="ps-head text-4xl font-bold ps-grad-text">{stat.value}</div>
                )}
                <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── ABOUT ── */}
      {hasAbout && (
        <section id="about" className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-14 items-center">
          <div className="reveal relative">
            <div className="absolute -inset-4 ps-about-glow rounded-3xl" />
            <div className="relative rounded-3xl overflow-hidden h-80 ps-card ps-soft">
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

          <div className="reveal">
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
      <CoursesFeatured courses={data.courses} />
      {/* Full catalogue lives on its own page now */}
      {hasAcademics && (
        <div className="max-w-6xl mx-auto px-6 -mt-8 pb-14">
          <a href="/academics" className="text-sm font-semibold hover:opacity-80 transition" style={{ color: 'var(--ps1)' }}>
            View all programmes →
          </a>
        </div>
      )}

      {/* ── ADMISSIONS (process + fee structure) ── */}
      {hasAdmissions && show.admissions && <AdmissionsSection admissions={data.admissions} courses={data.courses} />}

      {/* ── GALLERY ── */}
      {hasGallery && show.gallery && <GallerySection gallery={data.gallery} schoolName={schoolName} />}

      {/* ── HALL OF FAME (class-wise toppers) ── */}
      {hasHof && <HallOfFame courses={data.courses} />}

      {/* ── CONNECT / EVENTS ── */}
      {hasEvents && show.events && <EventsSection events={data.events} timezone={data.school.timezone} />}

      {/* ── EDUCATORS / STAFF ── */}
      {data.staff.length > 0 && (
        <section id="staff" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal text-center max-w-2xl mx-auto">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              Our people
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">Meet our educators</h2>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6">
            {data.staff.map((person, i) => (
              <div
                key={i}
                className="reveal ps-lift ps-card ps-soft rounded-3xl p-6 text-center"
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

      {/* ── FOOTER ── */}
      <footer className="border-t border-black/10 mt-8">
        <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                <img src={logoUrl} alt={schoolName} className="h-9 w-auto" loading="lazy" decoding="async" />
              ) : (
                <>
                  <span className="h-9 w-9 rounded-xl ps-logo-bg grid place-items-center font-bold text-white text-sm ps-head">
                    {schoolName.charAt(0)}
                  </span>
                  <span className="ps-head font-bold">{schoolName}</span>
                </>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-3">Nurturing confident, compassionate lifelong learners.</p>
          </div>
          <div>
            <div className="ps-head font-bold mb-3">Explore</div>
            <ul className="space-y-2 text-sm text-slate-500">
              {hasAbout && <li><a href={`${base}#about`} className="hover:text-slate-900 transition">About</a></li>}
              {hasAcademics && <li><a href="/academics" className="hover:text-slate-900 transition">Academics</a></li>}
              {hasAdmissions && <li><a href="/admissions" className="hover:text-slate-900 transition">Admissions</a></li>}
              {hasHof && <li><a href={`${base}#hall-of-fame`} className="hover:text-slate-900 transition">Hall of Fame</a></li>}
              {hasGallery && <li><a href="/gallery" className="hover:text-slate-900 transition">Gallery</a></li>}
              {hasEvents && <li><a href="/connect" className="hover:text-slate-900 transition">Connect</a></li>}
              {hasBlog && <li><Link href="/blog" className="hover:text-slate-900 transition">Blog</Link></li>}
              <li><a href="/contact" className="hover:text-slate-900 transition">Enquire</a></li>
            </ul>
          </div>
          <div>
            <div className="ps-head font-bold mb-3">Contact</div>
            <ul className="space-y-2 text-sm text-slate-500">
              {data.profile?.phone && <li>📞 {data.profile.phone}</li>}
              {data.profile?.email && <li>✉️ {data.profile.email}</li>}
              {data.profile?.city && (
                <li>📍 {data.profile.city}{data.profile.region ? `, ${data.profile.region}` : ''}</li>
              )}
              {!data.profile?.phone && !data.profile?.email && !data.profile?.city && (
                <li className="text-slate-400">—</li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-black/10 text-center text-xs text-slate-400 py-4">
          © {new Date().getFullYear()} {schoolName} · Powered by Sckools
        </div>
      </footer>
    </div>
  );
}
