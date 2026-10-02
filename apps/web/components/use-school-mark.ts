'use client';

import { useEffect } from 'react';

/**
 * THE SCHOOL'S MARK IN THE BROWSER TAB, set from the client.
 *
 * Every console and portal shell is a `'use client'` file, and Next forbids a
 * client component from exporting metadata — so the usual route (a server
 * `generateMetadata`) is closed unless the layout is split in two. That split
 * was tried and measured on 2026-09-30: reading the host in a server layout
 * made `/app`, `/portal` and `/teacher` fall from PRERENDERED to dynamic and
 * deleted their prerendered shells, which is the very thing
 * `console-shell.test.ts` exists to protect. A favicon is not worth a blank
 * first paint.
 *
 * So the icon is set imperatively instead. It happens after hydration — the
 * tab shows the Tassel-S for a moment first — which is the honest trade and
 * invisible on a screen that is client-rendered anyway.
 *
 * `null` deliberately does nothing: a school with no mark of its own keeps
 * the platform's, which beats a broken image.
 */
export function useSchoolMark(url: string | null | undefined): void {
  useEffect(() => {
    if (!url || typeof document === 'undefined') return;
    // Replace every existing icon link, not just the first: Next emits both a
    // `rel="icon"` and, on some routes, a `rel="shortcut icon"`, and leaving
    // one behind means the browser can still pick ours.
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    // `getAttribute`, never `.href`: the property RESOLVES the value, so a
    // relative `/icon.svg` is read back as `https://host/icon.svg` and
    // restoring it would rewrite the document's own markup into absolute
    // URLs against whatever host happened to be current.
    // `type` and `sizes` describe the OLD file. Next emits type="image/svg+xml" sizes="any" for the Tassel-S, and
    // leaving them on a PNG crest makes the browser try to draw a PNG as an SVG, fail, and keep our mark in the tab.
    const previous = links.map((l) => ({ el: l, href: l.getAttribute('href'), type: l.getAttribute('type'), sizes: l.getAttribute('sizes') }));
    if (links.length === 0) {
      const made = document.createElement('link');
      made.rel = 'icon';
      made.setAttribute('href', url);
      document.head.appendChild(made);
      return () => made.remove();
    }
    for (const l of links) {
      l.setAttribute('href', url);
      l.removeAttribute('type');
      l.removeAttribute('sizes');
    }
    // Put the platform's mark back when the shell unmounts, so signing out of
    // a school does not leave its crest on the platform's own pages.
    return () => {
      for (const p of previous) {
        if (p.href === null) p.el.removeAttribute('href');
        else p.el.setAttribute('href', p.href);
        if (p.type !== null) p.el.setAttribute('type', p.type);
        if (p.sizes !== null) p.el.setAttribute('sizes', p.sizes);
      }
    };
  }, [url]);
}
