import { View } from 'react-native';
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { SckoolsLogo } from '@/components/SckoolsLogo';
import { brand } from '@/theme/tokens';
import { session } from '@/lib/session';
import { family } from '@/lib/family-store';
import { portalForSession, resolveStartRoute } from '@/lib/roles';

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
          portalForSession(s);
        } catch {
          await session.clear();
        }
      }
      setTarget(resolveStartRoute(s));
    })().catch(async () => {
      // A torn SecureStore write or an unparseable saved session used to
      // reject here with nothing to catch it, so setTarget never ran and the
      // app sat on the logo for good — the same symptom the ALUMNUS bug had.
      // Start clean instead: the gate is always a real screen.
      try { await session.clear(); } catch { /* nothing left to clear */ }
      setTarget(resolveStartRoute(null));
    });
  }, []);
  // A blank frame used to sit here for the whole boot chain (perf audit #5).
  // The chain is much shorter now that the session is read once, but the
  // first frame should still belong to the school, not to nothing.
  if (!target) return <BootFrame />;
  return <Redirect href={target as never} />;
}

/** The one frame between the native splash and the first screen. */
function BootFrame() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.gate.light.bgBottom }}>
      <SckoolsLogo size={34} />
    </View>
  );
}
