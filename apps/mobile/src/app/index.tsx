import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { session } from '@/lib/session';
import { family } from '@/lib/family-store';
import { portalForRole, resolveStartRoute } from '@/lib/roles';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      // A pre-5·2 single STUDENT session becomes a one-child shelf, so
      // switch-diary and add-a-child work right after the update.
      await family.migrateLegacy();
      const s = await session.get();
      // A persisted session whose role can't be routed on mobile (OWNER —
      // web-only) must not brick the bootstrap forever. resolveStartRoute
      // never throws; if the role was unroutable, clear the bad session as a
      // side effect so future launches don't keep tripping over it.
      if (s) {
        try {
          portalForRole(s.role);
        } catch {
          await session.clear();
        }
      }
      setTarget(resolveStartRoute(s));
    })();
  }, []);
  if (!target) return null;
  return <Redirect href={target as never} />;
}
