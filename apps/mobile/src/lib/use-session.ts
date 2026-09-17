import { useEffect, useState } from 'react';
import { session, type Session } from './session';

/**
 * The persisted session, for a screen that needs to know WHO before it can
 * draw — which tabs to show, which doors to put on Home. Resolves once per
 * mount; `null` until it does, and `null` when nobody is signed in. Screens
 * that only need data go through lib/query.ts, which reads the session itself.
 */
export function useSession(): Session | null {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
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
