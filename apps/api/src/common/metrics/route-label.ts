const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUM = /\/\d{2,}(?=\/|$)/g;

/** Cap on distinct route labels one instance will track in a minute. */
export const MAX_ROUTE_LABELS = 200;

/**
 * A stable label for a request.
 *
 * Express fills `req.route.path` with the declared pattern (`/manage/students/:id`),
 * which is already what we want. The fallback matters for anything that never
 * reached a handler — a 404, or a guard rejecting before routing — where the raw
 * URL is all there is. Left raw, every tenant id in a path would become its own
 * metric series and the store would grow without bound; that is the classic way
 * a metrics system takes down the thing it was meant to watch.
 */
export function routeLabel(method: string, routePath: string | undefined, url: string): string {
  if (routePath) return `${method} ${routePath}`;
  const path = url.split('?')[0];
  const templated = path.replace(UUID, ':id').replace(LONG_NUM, '/:n');
  return `${method} ${templated}`;
}

/**
 * Last-resort guard: if labels still somehow multiply (an unrouted scanner
 * hitting random paths), stop adding new ones rather than grow unbounded.
 * Returns the label to use, or null to drop the sample.
 */
export function capLabels(known: Set<string>, label: string): string | null {
  if (known.has(label)) return label;
  if (known.size >= MAX_ROUTE_LABELS) return null;
  known.add(label);
  return label;
}
