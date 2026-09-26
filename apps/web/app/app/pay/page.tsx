'use client';
import { Suspense } from 'react';
import HomeTab from './home-tab';

// useSearchParams needs a Suspense boundary in the App Router, or the whole
// route de-opts to client rendering with a build warning.
export default function AppPayPage() {
  return (
    <Suspense fallback={<div className="sk-state" aria-busy="true">Loading…</div>}>
      <HomeTab base="/app/pay" />
    </Suspense>
  );
}
