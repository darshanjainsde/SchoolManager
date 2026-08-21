'use client';

import { useEffect } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { PS_CSS } from './ps-css';
import { themeRootProps, navFlagsFor } from './site-theme';
import { admissionsHasContent } from './sections/AdmissionsSection';
import { hofCourses } from './sections/HallOfFame';
import SiteNav from './sections/SiteNav';

/**
 * A school's identity, wrapped around a page that is not the school site.
 *
 * The blog rendered outside all of this: its own bare "← Home" topbar, none of
 * the school's colours, none of its fonts, and no way back into the site. A
 * parent following a link from a newsletter landed somewhere that could have
 * belonged to any school in the network — which is precisely the sameness this
 * phase exists to remove.
 *
 * It reuses `themeRootProps` and the real `SiteNav` rather than restating
 * either, so the blog cannot drift away from the site again.
 */
export default function SchoolChrome({
  data,
  children,
}: {
  data: PublicSiteData;
  children: React.ReactNode;
}) {
  const { className, style } = themeRootProps(data);
  const flags = navFlagsFor(data, {
    hasAbout: !!data.homepage?.aboutText,
    hasAcademics: data.courses.length > 0,
    hasAdmissions: admissionsHasContent(data.admissions, data.courses),
    hasHof: hofCourses(data.courses).length > 0,
  });

  // The nav elevates on scroll on every other page; without this the blog's
  // bar would be the one that never does. The same pass reveals `.reveal`
  // content — PS_CSS hides it until the `.in` class arrives, and this chrome
  // had no revealer at all, so anything marked reveal stayed invisible
  // forever (the blog index header shipped blank). Position-based, exactly
  // like PublicSite: no IntersectionObserver, so a background tab still shows
  // everything the moment it is foregrounded.
  useEffect(() => {
    const nav = document.getElementById('ps-nav');
    const reveals = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    const sweep = () => {
      const vh = window.innerHeight || 800;
      if (nav) nav.classList.toggle('ps-nav-scrolled', window.scrollY > 30);
      for (let i = reveals.length - 1; i >= 0; i--) {
        if (reveals[i].getBoundingClientRect().top < vh * 0.92) {
          reveals[i].classList.add('in');
          reveals.splice(i, 1);
        }
      }
    };
    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; sweep(); });
    };
    sweep();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const onVis = () => { if (!document.hidden) sweep(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={className} style={style}>
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />
      {/* base="/" because nothing here is the homepage: section anchors have to
          travel back to it rather than pointing at this page. */}
      <SiteNav
        data={data}
        flags={flags}
        base="/"
        view="blog"
        onAcademicsPage={false}
        enquireHref="/contact"
        ink={style['--ink' as keyof typeof style] as string}
      />
      {children}
    </div>
  );
}
