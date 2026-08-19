'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import PublicSite from '@/components/public/PublicSite';
import type { PublicSiteData } from '@/lib/public-api';

/**
 * The studio's live canvas: the REAL public renderer, fed the school's real
 * payload, with the studio's unsaved design overrides merged over the profile
 * via same-origin postMessage. Because this is `PublicSite` itself — not a
 * mock — what the admin previews is pixel-for-pixel what publishing ships.
 *
 * No session, no console layout: this page renders only what /public/site
 * already serves to the world, so it deliberately sits outside the console
 * CSP matcher (see console-segments.test.ts — no useSessionProbe here).
 */

type Overrides = Record<string, unknown>;

export default function StudioPreviewPage() {
  const [data, setData] = useState<PublicSiteData | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const host = window.location.host;
    fetch(`${base}/public/site`, {
      headers: { 'X-Skoolos-Host': host, 'X-Forwarded-Host': host },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) {
          setFailed(r.status);
          return;
        }
        setData((await r.json()) as PublicSiteData);
      })
      .catch(() => setFailed(0));
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Same-origin only: the studio and this canvas share the school host.
      if (e.origin !== window.location.origin) return;
      const m = e.data as { type?: string; overrides?: unknown } | null;
      if (m?.type === 'sk-studio-preview' && m.overrides && typeof m.overrides === 'object') {
        setOverrides(m.overrides as Overrides);
      }
    };
    window.addEventListener('message', onMessage);
    // Tell the studio we exist so it can (re)send the current look.
    window.parent?.postMessage({ type: 'sk-studio-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (failed !== null) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold text-slate-700">The live preview needs your public site</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            {failed === 404
              ? 'Your site has not been published yet — the preview mirrors your live site data once it is live.'
              : 'The site data could not be loaded. Check your connection and reload.'}
          </p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-400">Loading preview…</div>;
  }

  const merged: PublicSiteData = {
    ...data,
    profile: data.profile
      ? ({ ...data.profile, ...overrides } as PublicSiteData['profile'])
      : data.profile,
  };

  return (
    <SettledCanvas overridesKey={JSON.stringify(overrides)}>
      <ClickInertPublicSite data={merged} />
    </SettledCanvas>
  );
}

/**
 * PublicSite's reveal/count observers run once at mount and unobserve. When an
 * override re-renders a band, its fresh `.reveal`/`.count` nodes are never
 * observed and would sit at opacity 0 / "0" forever. The studio is for SEEING
 * the design, not re-scrolling to reveal it — so after every override change
 * we settle the whole canvas to its end state.
 */
function SettledCanvas({ overridesKey, children }: { overridesKey: string; children: React.ReactNode }) {
  useLayoutEffect(() => {
    let raf = 0;
    const settle = () => {
      document.querySelectorAll('.reveal, .ps-journey, .ps-rail').forEach((el) => el.classList.add('in'));
      document.querySelectorAll<HTMLElement>('.count').forEach((el) => {
        const to = Number(el.dataset.to);
        if (!Number.isNaN(to)) el.textContent = (to >= 1000 ? to.toLocaleString() : String(to)) + (el.dataset.suffix ?? '');
      });
    };
    // Two rAFs: let PublicSite's own mount effect run first, then override it.
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(settle); });
    return () => cancelAnimationFrame(raf);
  }, [overridesKey]);
  return <>{children}</>;
}

function ClickInertPublicSite({ data }: { data: PublicSiteData }) {
  return (
    // Links stay inert inside the canvas: navigating the iframe to a real
    // public page would drop the unsaved overrides mid-review.
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
    >
      <PublicSite data={data} />
    </div>
  );
}
