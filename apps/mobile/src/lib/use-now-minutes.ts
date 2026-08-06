import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Minutes past midnight on the device's own clock. */
export function nowMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Milliseconds until the wall clock's next whole minute. Never 0, never > 60000. */
export function msToNextMinute(now: Date = new Date()): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

/**
 * THE CLOCK THE "RIGHT NOW" CARD RUNS ON.
 *
 * Everything on the teacher's Home that speaks in the present tense — which
 * period is live, how far through it we are, which register is overdue — was
 * computed once, at render, from `new Date()`. A teacher who opened the app at
 * 10:59 and glanced at it again at 11:20 was reading a card that still said the
 * previous lesson was live, and the only way to correct it was to leave the
 * screen and come back.
 *
 * Two details make this cheap enough to leave running:
 *
 * ALIGNED, NOT EVERY 60s. The timer is set to the next whole minute rather than
 * a flat 60-second interval, so the card flips within a second of the bell
 * instead of up to 59 seconds after it, and it cannot drift further out with
 * every tick. Each tick re-arms from the clock, so a slow render doesn't
 * compound.
 *
 * IDENTICAL STATE BAILS OUT. The setter returns the previous value when the
 * minute hasn't actually changed, which React treats as no update at all — so a
 * tick that lands in the same minute (a foreground re-sync, a rounding
 * straggler) costs nothing.
 *
 * RESYNC ON FOREGROUND is not optional: timers do not run reliably while the
 * app is backgrounded, so a phone put in a pocket during first period and taken
 * out at lunch comes back with a stale minute and a timer that may fire at any
 * offset. Returning to foreground reads the clock directly and re-arms.
 */
export function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => nowMinutes());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => setMinutes((prev) => {
      const next = nowMinutes();
      return next === prev ? prev : next;
    });

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sync();
        arm();
      }, msToNextMinute());
    };

    arm();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return;
      sync();
      arm();
    });

    return () => {
      if (timer) clearTimeout(timer);
      // On a device this is always an EmitterSubscription, exactly as RN types
      // it. jest-expo's AppState mock returns a bare `{}` with no `remove`, and
      // every test that mounts a screen using this hook unmounts it on cleanup —
      // so an unguarded call would fail those tests for a reason that has
      // nothing to do with the app. Guarded here rather than by patching the
      // preset, which would put a shared config change behind one hook.
      sub?.remove?.();
    };
  }, []);

  return minutes;
}
