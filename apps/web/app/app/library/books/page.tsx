'use client';
import { Suspense } from 'react';
import CatalogueTab from '../catalogue-tab';

export default function AppLibraryCataloguePage() {
  // useSearchParams inside needs a Suspense boundary, or the route de-opts to client rendering.
  return <Suspense fallback={<p className="sk-state" aria-busy="true">Loading…</p>}><CatalogueTab /></Suspense>;
}
