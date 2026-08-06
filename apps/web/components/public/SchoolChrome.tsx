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
  // bar would be the one that never does.
  useEffect(() => {
    const nav = document.getElementById('ps-nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('ps-nav-scrolled', window.scrollY > 30);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
