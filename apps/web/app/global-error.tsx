'use client';
import { useEffect } from 'react';

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, where
 * `app/error.tsx` cannot run. It replaces the whole document, so it must ship
 * its own <html>/<body> and cannot rely on globals.css being applied.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global-error]', error.digest ?? '', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', background: '#f8fafc' }}>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 32 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Sckools is temporarily unavailable</h1>
            <p style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>
              We hit an unexpected error loading the page. Please try again in a moment.
            </p>
            {error.digest && <p style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>ref: {error.digest}</p>}
            <button
              onClick={reset}
              style={{ marginTop: 20, background: '#0d9488', color: '#fff', border: 0, borderRadius: 12, padding: '10px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
