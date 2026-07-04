'use client';
import { useEffect, useState } from 'react';

/**
 * Returns false during SSR and the first client paint, then true after mount.
 *
 * The auth store seeds `refreshToken` from localStorage at module load, so the
 * server (no localStorage) and the first client render disagree — which trips
 * React hydration in auth-gated layouts. Gate those layouts on this hook so the
 * first client paint matches the server, then re-render once hydrated.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
