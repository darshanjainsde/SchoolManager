import { randomUUID } from 'node:crypto';
import { runInBackground } from '../notifications/run-in-background';

/**
 * Launch-gate #4: seeing errors before the principal does.
 *
 * A deliberately tiny Sentry reporter — the full @sentry/node SDK drags
 * OpenTelemetry into the ncc bundle this API ships as, and everything the
 * launch gate needs is "unhandled errors reach a pager". This speaks the
 * Sentry store protocol directly: parse the DSN once, POST the event,
 * never throw, never block the response (runInBackground → waitUntil on
 * Vercel, so the send survives the lambda freeze).
 *
 * No SENTRY_DSN configured → every call is a no-op. No PII is ever attached:
 * callers pass shape/context (route, kind), never user emails or names.
 */

interface Endpoint {
  url: string;
  key: string;
}

let cached: Endpoint | null | undefined;

function endpoint(): Endpoint | null {
  if (cached !== undefined) return cached;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    cached = null;
    return cached;
  }
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

/** Exposed for tests. */
export function resetSentryLite(): void {
  cached = undefined;
}

const FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|([^)]+))\)?\s*$/;

function frames(stack: string | undefined) {
  if (!stack) return undefined;
  const out = stack
    .split('\n')
    .slice(1, 51)
    .map((line) => {
      const m = FRAME_RE.exec(line);
      if (!m) return { function: line.trim().slice(0, 200) };
      return {
        function: (m[1] ?? '<anonymous>').slice(0, 200),
        filename: (m[2] ?? m[5] ?? '').slice(0, 300),
        lineno: m[3] ? Number(m[3]) : undefined,
        colno: m[4] ? Number(m[4]) : undefined,
      };
    })
    .reverse(); // Sentry wants oldest-first
  return out.length ? { frames: out } : undefined;
}

/**
 * Report an error to Sentry. Safe to call from anywhere: never throws, adds
 * no latency to the caller, no-ops without a DSN.
 */
export function captureError(err: unknown, context: Record<string, string | number | boolean> = {}): void {
  const ep = endpoint();
  if (!ep) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    server_name: 'skoolos-api',
    exception: {
      values: [
        {
          type: e.name.slice(0, 100),
          value: e.message.slice(0, 800),
          stacktrace: frames(e.stack),
        },
      ],
    },
    extra: context,
  };
  runInBackground(
    () =>
      fetch(ep.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_client=skoolos-lite/1, sentry_key=${ep.key}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(3000),
      }),
    () => undefined,
  );
}
