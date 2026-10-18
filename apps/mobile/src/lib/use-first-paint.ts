import { useEffect, useRef, useState } from 'react';

/** How long a Home waits for its small extras (badges, counts) before drawing without them. */
export const FIRST_PAINT_CAP_MS = 1200;

/**
 * ONE FIRST FRAME FOR A WHOLE SCREEN (user, 18 Oct 2026: "something is
 * rendering fast and something rendering slow"). A Home asks several
 * questions at once; drawn as each answer lands, the name, the hero, the
 * tiles and their badges pop in one by one and the grid jumps.
 *
 * So the screen holds its skeleton until the `core` answer is in (the thing
 * without which there is no page), and gives the `extras` (badges, counts)
 * up to `capMs` more to land with it. A slow badge never holds the page: past
 * the cap the page draws and the badge arrives on its own.
 *
 * Once drawn it stays drawn — a refetch on focus or pull never puts the
 * skeleton back, because the old answers stay on screen until new ones land.
 */
export function useFirstPaint(coreDone: boolean, extrasPending: boolean[], capMs = FIRST_PAINT_CAP_MS): boolean {
  const extrasDone = extrasPending.every((p) => !p);
  const [capPassed, setCapPassed] = useState(false);
  const painted = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => setCapPassed(true), capMs);
    return () => clearTimeout(t);
  }, [capMs]);
  if (coreDone && (extrasDone || capPassed)) painted.current = true;
  return painted.current;
}
