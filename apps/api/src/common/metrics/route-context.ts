import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The route label for the request currently being handled.
 *
 * Exists so a tenant transaction deep in a service can be attributed to the
 * endpoint that caused it, without threading a label through every signature —
 * and without packages/db learning anything about HTTP.
 */
const store = new AsyncLocalStorage<string>();

export function runWithRouteLabel<T>(label: string, fn: () => T): T {
  return store.run(label, fn);
}

export function currentRouteLabel(): string | undefined {
  return store.getStore();
}
