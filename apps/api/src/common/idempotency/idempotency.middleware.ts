import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Decode a Bearer JWT payload's `sub` claim WITHOUT verifying the signature.
 * Used only to namespace the idempotency-key store; a forged JWT is harmless
 * because the request will still be 401-ed by the JWT guard later (we only
 * cache 2xx responses). Returns undefined if the header is missing or
 * malformed.
 */
function readBearerSub(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]*)$/i.exec(header.trim());
  if (!m) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8')) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * RFC-9457-ish Idempotency-Key support.
 *
 *   - Only applies to mutating methods (POST/PATCH/PUT/DELETE).
 *   - Key form: client-supplied `Idempotency-Key` header (any opaque string,
 *     ≤ 200 chars).
 *   - Lookup key in our store: <tenantOrPlatform>:<userIdOrAnon>:<rawKey>.
 *     This keeps two tenants from colliding on the same client-side string,
 *     and two users in the same tenant from racing on each other's keys.
 *   - On HIT: replay the cached response (statusCode + body), DO NOT touch the
 *     downstream handler.
 *   - On MISS: forward, capture the response, store on 2xx, leave alone on 5xx
 *     so the client retries.
 *
 * Stored in the IdempotencyKey table (Postgres) with a 24-hour expiresAt.
 * Cleanup is best-effort — see Phase 7 cron in PRODUCTION.md.
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const raw = req.header('idempotency-key');
    const method = req.method.toUpperCase();
    if (!raw || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next();
    }
    if (raw.length > 200) {
      res.status(400).json({ message: 'Idempotency-Key too long (>200 chars)' });
      return;
    }

    const tenant =
      (req as unknown as { tenant?: { kind: string; schoolId?: string } }).tenant;
    const tenantKey = tenant?.kind === 'tenant' ? `tenant:${tenant.schoolId}` : tenant?.kind === 'platform' ? 'platform' : 'public';
    // NB: JWT guards run AFTER middleware, so `req.user` is always undefined
    // here. We extract `sub` from the bearer payload WITHOUT verifying — if
    // the signature is forged the guard later rejects with 401 and nothing
    // gets cached (we only cache 2xx). This keeps the per-user namespace
    // intact so two distinct authed users in the same tenant don't replay
    // each other's responses.
    const userKey = readBearerSub(req.header('authorization')) ?? 'anon';
    const storeKey = `${tenantKey}:${userKey}:${raw}`;

    const platform = getPlatformPrisma();
    try {
      const cached = await platform.idempotencyKey.findUnique({ where: { key: storeKey } });
      if (cached && cached.expiresAt > new Date()) {
        // Replay.
        res.setHeader('Idempotency-Replayed', '1');
        res.status(cached.statusCode);
        res.json(cached.responseBody);
        return;
      }
    } catch (e) {
      this.logger.warn(`Idempotency lookup failed: ${(e as Error).message}`);
      return next();
    }

    // Capture downstream response.
    const chunks: Buffer[] = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    let captureFailed = false;

    // Express overloads: write/end may be called with a callback FIRST instead
    // of a chunk (e.g. `res.end(cb)`). Only push when we actually got a
    // string/Buffer chunk; anything else (function, undefined) is left alone.
    const pushIfChunk = (v: unknown): void => {
      if (typeof v === 'string') chunks.push(Buffer.from(v));
      else if (Buffer.isBuffer(v)) chunks.push(v);
      else if (v instanceof Uint8Array) chunks.push(Buffer.from(v));
    };
    (res as unknown as { write: typeof origWrite }).write = function (chunk: unknown, ...args: unknown[]): boolean {
      try { pushIfChunk(chunk); } catch { captureFailed = true; }
      return (origWrite as unknown as (c: unknown, ...a: unknown[]) => boolean)(chunk, ...args);
    };
    (res as unknown as { end: typeof origEnd }).end = function (chunk: unknown, ...args: unknown[]): Response {
      try { pushIfChunk(chunk); } catch { captureFailed = true; }
      return (origEnd as unknown as (c: unknown, ...a: unknown[]) => Response)(chunk, ...args);
    };

    res.on('finish', () => {
      if (captureFailed) return;
      // Only cache 2xx responses. Non-2xx implies client should retry with a fresh attempt.
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const hash = createHash('sha256').update(text).digest('hex');
      platform.idempotencyKey
        .upsert({
          where: { key: storeKey },
          create: {
            key: storeKey,
            method,
            path: req.originalUrl,
            responseHash: hash,
            responseBody: body as never,
            statusCode: res.statusCode,
            expiresAt: new Date(Date.now() + this.TTL_MS),
          },
          update: {},
        })
        .catch((e: Error) => this.logger.warn(`Idempotency persist failed: ${e.message}`));
    });

    next();
  }
}
