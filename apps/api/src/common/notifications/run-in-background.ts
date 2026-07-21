type WaitUntil = (promise: Promise<unknown>) => void;

let cachedWaitUntil: WaitUntil | null | undefined;

/**
 * `@vercel/functions`' `waitUntil`, when we are actually running on Vercel.
 *
 * Off Vercel (local dev, `pnpm test`, the worker) the module may not even be
 * installed, so the import is guarded and lazy: `require` inside try/catch,
 * resolved once and memoised. Anything but a live Vercel invocation gets
 * `null` and falls back to a plain floating promise.
 */
function getWaitUntil(): WaitUntil | null {
  if (cachedWaitUntil !== undefined) return cachedWaitUntil;

  cachedWaitUntil = null;
  if (process.env.VERCEL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@vercel/functions') as { waitUntil?: WaitUntil };
      if (typeof mod?.waitUntil === 'function') {
        cachedWaitUntil = mod.waitUntil;
      }
    } catch {
      cachedWaitUntil = null;
    }
  }
  return cachedWaitUntil;
}

/** Test seam: forget the memoised lookup. */
export function resetWaitUntilCache(): void {
  cachedWaitUntil = undefined;
}

/**
 * Runs best-effort work that must NOT block (or fail) the response.
 *
 * On Vercel, work started after the response is returned can be frozen the
 * moment the function goes idle — a fire-and-forget notification would then
 * simply never be delivered. `waitUntil` keeps the invocation alive until the
 * promise settles. Everywhere else this degrades to the ordinary floating
 * promise with a catch, so nothing can ever reject unhandled.
 */
export function runInBackground(work: () => Promise<unknown>, onError: (error: unknown) => void): void {
  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(work());
  } catch (e) {
    onError(e);
    return;
  }

  const settled = promise.catch(onError);

  const waitUntil = getWaitUntil();
  if (waitUntil) {
    try {
      waitUntil(settled);
    } catch {
      // No request context (e.g. a warm-up invocation) — the floating promise
      // above still runs; there is nothing else to do here.
    }
  }
}
