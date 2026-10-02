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
 * IT IS NOT A ONE-SHOT SWAP, and the first version's being one was the bug.
 * The App Router re-renders `<head>` on every client navigation: each route
 * contributes its own `<link rel="icon">`, so the links this hook rewrote are
 * REPLACED by fresh ones pointing at the platform mark. The effect does not
 * re-run — the url has not changed — so moving between console pages put our
 * Tassel-S back on the school's own tab until a full reload. Reported by the
 * owner: "whenever i change tab or anything the school logo replaces by
 * sckools logo and upon reload the actual school logo comes back".
 *
 * The fix is to keep watching: a `MutationObserver` on `<head>` re-applies the
 * crest whenever something puts a different icon there. It is cheap (one
 * observer per shell, firing only on head changes) and it cannot be defeated
 * by whatever the framework does to the head next.
 *
 * `null` deliberately does nothing: a school with no mark of its own keeps
 * the platform's, which beats a broken image.
 */
export function useSchoolMark(url: string | null | undefined): void {
  useEffect(() => {
    if (!url || typeof document === 'undefined') return;
    const head = document.head;

    // What the document said before we touched it, so signing out of a school
    // does not leave its crest on the platform's own pages. Captured once:
    // later head rewrites are the framework re-stating the same default.
    //
    // `getAttribute`, never `.href`: the property RESOLVES the value, so a
    // relative `/icon.svg` is read back as `https://host/icon.svg` and
    // restoring it would rewrite the document's own markup into absolute
    // URLs against whatever host happened to be current.
    const original = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
      .map((el) => ({ el, href: el.getAttribute('href'), type: el.getAttribute('type'), sizes: el.getAttribute('sizes') }));

    /** A link this hook created because the document had none of its own. */
    let made: HTMLLinkElement | null = null;

    const apply = () => {
      // Every icon link, not just the first: Next emits both a `rel="icon"`
      // and, on some routes, a `rel="shortcut icon"`, and leaving one behind
      // means the browser can still pick ours.
      const links = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
      if (links.length === 0) {
        if (made?.isConnected) return;
        made = document.createElement('link');
        made.rel = 'icon';
        made.setAttribute('href', url);
        head.appendChild(made);
        return;
      }
      for (const l of links) {
        // Guarded, so the observer is not woken by this hook's own writes.
        if (l.getAttribute('href') === url && !l.hasAttribute('type') && !l.hasAttribute('sizes')) continue;
        l.setAttribute('href', url);
        // `type` and `sizes` describe the OLD file. Next emits
        // type="image/svg+xml" sizes="any" for the Tassel-S, and leaving them
        // on a PNG crest makes the browser try to draw a PNG as an SVG, fail,
        // and keep our mark in the tab.
        l.removeAttribute('type');
        l.removeAttribute('sizes');
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

    return () => {
      observer.disconnect();
      made?.remove();
      made = null;
      for (const p of original) {
        if (!p.el.isConnected) continue; // the framework already replaced it
        if (p.href === null) p.el.removeAttribute('href');
        else p.el.setAttribute('href', p.href);
        if (p.type !== null) p.el.setAttribute('type', p.type);
        if (p.sizes !== null) p.el.setAttribute('sizes', p.sizes);
      }
    };
  }, [url]);
}
