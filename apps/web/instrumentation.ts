/**
 * Launch-gate #4: seeing errors before the principal does — web tier.
 *
 * Next 15 calls `onRequestError` for every uncaught error in server
 * components, route handlers and middleware. Like the API's sentry-lite,
 * this posts straight to the Sentry store endpoint instead of shipping the
 * full SDK: the launch gate needs "SSR failures reach a pager", not tracing.
 *
 * No SENTRY_DSN → no-op. No PII: the route path and render context only.
 */

interface Endpoint {
  url: string;
  key: string;
}

let cached: Endpoint | null | undefined;

function endpoint(): Endpoint | null {
  if (cached !== undefined) return cached;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return (cached = null);
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) throw new Error('malformed DSN');
    cached = { url: `${u.protocol}//${u.host}/api/${projectId}/store/`, key: u.username };
  } catch {
    cached = null;
  }
  return cached;
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string },
): Promise<void> {
  const ep = endpoint();
  if (!ep) return;
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    await fetch(ep.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=skoolos-lite/1, sentry_key=${ep.key}`,
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
        server_name: 'skoolos-web',
        exception: {
          values: [
            {
              type: e.name.slice(0, 100),
              value: e.message.slice(0, 800),
            },
          ],
        },
        extra: {
          path: request.path,
          method: request.method,
          routerKind: context.routerKind,
          routeType: context.routeType,
          stack: (e.stack ?? '').slice(0, 4000),
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Reporting must never cascade into the request path.
  }
}
