'use client';
import { Suspense } from 'react';
import CounterTab from '../counter-tab';

export default function AppLibraryCounterPage() {
  // useSearchParams inside needs a Suspense boundary, or the route de-opts to client rendering.
  return <Suspense fallback={<p className="sk-state" aria-busy="true">Loading…</p>}><CounterTab /></Suspense>;
}
