import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { session } from '@/lib/session';
import { portalForRole, resolveStartRoute } from '@/lib/roles';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const s = await session.get();
      const host = await session.getSchoolHost();
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
      setTarget(resolveStartRoute(s, host));
    })();
  }, []);
  if (!target) return null;
  return <Redirect href={target as never} />;
}
