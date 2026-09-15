'use client';

import { useEffect } from 'react';

/**
 * The public site's two document-wide motion behaviours, and nothing else.
 *
 * They were inline in PublicSite, which is the only reason that component had
 * to be a client component at all — everything else in it is pure computation
 * over server data. Both effects reach the DOM through document queries rather
 * than refs, so they do not need to live beside the markup they animate; moving
 * them into this leaf lets PublicSite render on the server, which in turn stops
 * eight purely presentational sections from being shipped and hydrated for
 * nothing.
 *
 * Renders null. Mount it once inside the site root.
 */
export default function SiteMotion({ glideOn }: { glideOn: boolean }) {
  useEffect(() => {
    const nav = document.getElementById('ps-nav');

    // Reveal-on-scroll and the count-up are POSITION-based, not driven by an
    // IntersectionObserver. Content is hidden until it gets `.in`, so a starved
    // observer — the page opened in a BACKGROUND tab (rAF + IO callbacks are
    // paused until it's shown), an engine that defers the first frame — left the
    // ENTIRE page permanently blank. A synchronous rect sweep on mount, plus on
    // scroll/resize/visibility, can never do that: whatever is on screen reveals
    // at once, the rest as it scrolls in, and nothing depends on an async frame.
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    const counts = Array.from(document.querySelectorAll<HTMLElement>('.count'));
    const runCount = (el: HTMLElement) => {
      const to = Number(el.dataset.to);
      if (isNaN(to)) return;
      const suffix = el.dataset.suffix ?? '';
      let n = 0;
      const step = Math.max(1, Math.round(to / 60));
      const timer = setInterval(() => {
        n += step;
        if (n >= to) { n = to; clearInterval(timer); }
        el.textContent = (to >= 1000 ? n.toLocaleString() : String(n)) + suffix;
      }, 18);
    };
    const sweep = () => {
      const vh = window.innerHeight || 800;
      if (nav) nav.classList.toggle('ps-nav-scrolled', window.scrollY > 30);
      for (let i = reveals.length - 1; i >= 0; i--) {
        if (reveals[i].getBoundingClientRect().top < vh * 0.92) {
          reveals[i].classList.add('in');
          reveals.splice(i, 1);
        }
      }
      for (let i = counts.length - 1; i >= 0; i--) {
        if (counts[i].getBoundingClientRect().top < vh * 0.85) {
          runCount(counts[i]);
          counts.splice(i, 1);
        }
      }
    };
    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; sweep(); });
    };
    sweep(); // reveal whatever is already on screen, synchronously
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // Opened in a background tab? Sweep again the moment it becomes visible.
    const onVis = () => { if (!document.hidden) sweep(); };
    document.addEventListener('visibilitychange', onVis);

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
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
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

  return null;
}
