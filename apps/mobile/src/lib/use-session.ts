import { useEffect, useState } from 'react';
import { session, type Session } from './session';

/**
 * The persisted session, for a screen that needs to know WHO before it can
 * draw — which tabs to show, which doors to put on Home. Resolves once per
 * mount; `null` until it does, and `null` when nobody is signed in. Screens
 * that only need data go through lib/query.ts, which reads the session itself.
 */
export function useSession(): Session | null {
  // Start from the copy already in memory: a null first frame is what made
  // Home draw without the name and the feature tiles, then reflow.
  const [s, setS] = useState<Session | null>(() => session.peek() ?? null);
  useEffect(() => {
    if (session.peek() !== undefined) return;
    let alive = true;
    session.get().then((v) => {
      if (alive) setS(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return s;
}
