'use client';
import { useEffect } from 'react';

/**
 * Route-level error boundary. Without this file an uncaught render or data
 * error takes the whole client tree down to a blank page — with it the visitor
 * gets a branded page and a retry that re-runs the failed segment.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surfaces in Vercel's function logs / the browser console with the digest
    // that Next assigns, which is how a report gets tied back to a deployment.
    console.error('[route-error]', error.digest ?? '', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-violet-600 text-xl font-black text-white">
          S
        </div>
        <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-500">
          This page failed to load. Trying again usually fixes it — if it doesn&rsquo;t, the Sckools team has the details.
        </p>
        {error.digest && <p className="mt-3 font-mono text-[11px] text-slate-400">ref: {error.digest}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-gradient-to-r from-teal-600 to-teal-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-teal-600/25 transition hover:-translate-y-0.5"
          >
            Try again
          </button>
          {/* Deliberately a hard navigation, not <Link>: the client tree is in a
              failed state, so a full document load is the reliable escape. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-400"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
