import { router } from 'expo-router';
import { api } from './api';
import { session } from './session';
import { family } from './family-store';

/**
 * Signing out, in one place.
 *
 * It used to live inline in `PortalToolsDrawer`, which made the tools drawer —
 * behind a chevron FAB — the ONLY way to sign out. Sign-out belongs on the
 * profile screen, where every other app on the phone has taught people to look
 * for it, so it is now called from both and the sequence exists once.
 *
 * The order matters and is not arbitrary:
 *
 *  1. Revoke the refresh token server-side FIRST, best-effort. `api.logout`
 *     swallows network failures on purpose — a lost or offline device must
 *     still be able to sign itself out locally, and refusing to clear the
 *     session because the network is down would leave a signed-in phone in a
 *     stranger's hands.
 *  2. Clear the persisted session.
 *  3. Clear the family shelf (Phase 5·2). A full sign-out forgets every linked
 *     child, not just the active one — leaving siblings behind would let the
 *     next person on the device see who else is in the family. A harmless
 *     no-op for staff, which never populates it.
 *  4. Return to CONNECT, not login: someone signing out may be switching
 *     school as well as account, and dropping them on a login form for the
 *     school they just left is a dead end.
 */
export async function signOut(): Promise<void> {
  await api.logout();
  await session.clear();
  await family.clearAll();
  router.replace('/(auth)/connect');
}
