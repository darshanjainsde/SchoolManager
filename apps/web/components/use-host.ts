'use client';
import { useEffect, useState } from 'react';

/**
 * The browser's host, for the API's tenant header.
 *
 * WHY THIS IS NOT JUST `window.location.host`.
 *
 * On the server there is no window, and the console shells are statically
 * prerendered — so the FIRST render on the client, the hydration pass, has to
 * produce exactly what the server produced or React throws the tree away and
 * re-renders it. That is why this started life as `useState(undefined)` plus
 * an effect.
 *
 * The cost of that was paid over and over. Every component that calls this
 * hook gets its own `useState`, so EVERY newly mounted subtree — every screen
 * the owner opens, all day — rendered once with `host === undefined`, which
 * means every `enabled: !!host` query was switched off, then committed, then
 * ran its effect, then re-rendered before a single byte was requested. 174
 * call sites across 149 files, each paying a full render-commit-effect cycle
 * before it was allowed to ask for anything.
 *
 * The host does not change while the tab is open, so the first component to
 * resolve it can tell the rest. `clientHost` below is that note. The very
 * first render of the very first caller still returns `undefined`, exactly as
 * the server did, so hydration is untouched — and every mount after that
 * starts with the host already in hand and fires its queries on render one.
 */
let clientHost: string | undefined;

export function useHost(): string | undefined {
  const [host, setHost] = useState<string | undefined>(clientHost);
  useEffect(() => {
    if (host) return;
    clientHost = window.location.host;
    setHost(clientHost);
  }, [host]);
  return host;
}

/** Test-only: forget the resolved host so each test starts from a cold tab. */
export function __resetHostForTests(): void {
  clientHost = undefined;
}
