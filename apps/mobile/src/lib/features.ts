import type { Session } from './session';

/**
 * Which paid modules this school has switched on — `features` from
 * `GET /auth/me`, kept on the session so the app never draws a door to a
 * room the school does not have. A session persisted before this field
 * existed has no list; every check then answers "no", and the next sign-in
 * fills it in. The server guards every route with `@RequireFeature` anyway —
 * this only decides what is DRAWN, never what is allowed.
 */
export type FeatureKey = 'FEES' | 'LIBRARY' | 'SPORTS' | 'PRESS' | (string & {});

export function hasFeature(s: Pick<Session, 'features'> | null | undefined, key: FeatureKey): boolean {
  return !!s?.features?.includes(key);
}
