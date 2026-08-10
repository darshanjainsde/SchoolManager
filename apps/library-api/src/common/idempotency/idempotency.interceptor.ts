import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { lastValueFrom, of, type Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { Prisma, withOrg, type LibraryTx } from '@library/db';
import { OrgContextService } from '../../modules/tenancy';

export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

export interface NewIdempotencyRecord extends IdempotencyRecord {
  orgId: string;
  key: string;
  endpoint: string;
}

export type CreateResult = { won: true } | { won: false; existing: IdempotencyRecord };

export interface IdempotencyStore {
  find(orgId: string, key: string): Promise<IdempotencyRecord | null>;
  /**
   * Persists a new record. MUST NOT throw when a concurrent request already
   * won the race to store first for this (orgId, key) — that is not an
   * error, it's the `@@unique([orgId, key])` constraint doing its job.
   * Return `{ won: false, existing }` instead so the caller can decide what
   * a losing, benign duplicate should look like to its own client.
   */
  create(row: NewIdempotencyRecord): Promise<CreateResult>;
}

/**
 * Deterministic across key order and `undefined` (which `JSON.stringify`
 * would otherwise drop from objects and turn into the string "undefined"
 * inside arrays) — two payloads that are the same JSON value but arrived
 * with differently-ordered keys must hash identically, or a client whose
 * JSON serializer doesn't preserve field order would spuriously trip the
 * "different request, same key" 409.
 */
function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForHash);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortForHash((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value === undefined ? null : value;
}

/**
 * Exported so tests can construct a matching/mismatching stored hash
 * without duplicating this logic.
 *
 * `\x00` (not a space) separates the three parts: a NUL byte cannot appear
 * in an HTTP method or a URL path, and JSON.stringify never emits one
 * either, so there is no input across method/path/body that could shift a
 * character from one field into another and still hash the same —
 * something a plain space separator would not guarantee.
 */
export function hashRequest(method: string, path: string, body: unknown): string {
  const canonical = `${method.toUpperCase()}\x00${path}\x00${JSON.stringify(sortForHash(body ?? null))}`;
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The concrete identity of a request for idempotency hashing: the actual URL
 * that was requested (path + query string), NOT `req.route?.path` (the
 * Express route *pattern*, e.g. `/loans/:id`). Using the pattern means
 * `POST /loans/1` and `POST /loans/2` — two different resources — hash
 * identically for the same `Idempotency-Key` and body, so the second request
 * would silently replay the first's response instead of either running or
 * correctly 409ing. `req.originalUrl` is Express's untouched original
 * request target (falls back to `req.url`/`req.path` for anything that
 * doesn't set it, e.g. this file's own unit-test fixtures).
 */
export function concreteRequestPath(req: Request): string {
  return req.originalUrl ?? req.url ?? req.path;
}

function getHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.toString().trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Barcode scanners double-fire; flaky phones retry. This interceptor makes
 * a client-supplied `Idempotency-Key` turn a *retried* write into a replay
 * of the first attempt's response instead of a second attempt.
 *
 * WHAT THIS DOES AND DOES NOT PROTECT AGAINST — read before wiring this
 * onto a new endpoint:
 *
 *   - Sequential retries (the common case: a request completes or fails,
 *     then the same key is sent again later) are fully idempotent. The
 *     second request never re-runs the handler; it gets back the first
 *     request's exact response.
 *   - Genuinely CONCURRENT duplicates (two identical requests in flight at
 *     the same time — the literal "scanner double-fires in the same
 *     instant" case this file's own tests exercise) are only guaranteed to
 *     converge on the same *response*. The handler itself can still run
 *     twice server-side before either request reaches the point of
 *     storing — see Decision 2 below. For an endpoint where a second
 *     handler execution is itself harmful (e.g. two loan rows, not just a
 *     wasted one), this interceptor is necessary but not sufficient: pair
 *     it with a database-level uniqueness constraint or an advisory lock
 *     the same way `assertQuota` in `require-quota.ts` uses
 *     `pg_advisory_xact_lock` to close the equivalent race for quota
 *     counting. Do not assume this class alone closes a double-scan.
 *
 * Behaviour:
 * - No `Idempotency-Key` header: does nothing at all. Never invents keys —
 *   idempotency is opt-in per request, chosen by the caller, not this class.
 * - Miss (`store.find` returns null): runs the handler, then stores
 *   `{ orgId, key, endpoint, requestHash, responseStatus, responseBody }`.
 * - Hit, same `requestHash`: replays the stored response without running
 *   the handler.
 * - Hit, different `requestHash`: 409 — the same key reused for a
 *   genuinely different request is a client bug worth surfacing loudly,
 *   not silently overwriting or silently serving the wrong cached answer.
 *
 * Two decisions this class makes that the brief left open — see
 * task-11-report.md for the full reasoning, summarised here:
 *
 * 1. Only responses with `status < 500` are stored. A stored 500 would mean
 *    a retry can never succeed even after the transient cause clears; 4xx
 *    responses are deterministic replays of the same client mistake, so
 *    caching them is both safe and desirable (the client doesn't need to
 *    re-trigger the same validation failure against the database).
 * 2. A concurrent duplicate — two requests for the same key arriving before
 *    either has stored — is resolved by the `@@unique([orgId, key])`
 *    constraint at the database, not by any check-then-write logic here.
 *    The loser's own `store.create` calls back with `{ won: false,
 *    existing }`; if `existing.requestHash` matches (the expected case,
 *    since both requests are the same bytes), the loser's client gets the
 *    winner's stored response instead of its own — so both callers using
 *    the same key see one canonical outcome, never a 500 from an
 *    unhandled unique-constraint violation. This is a *response*-level
 *    guarantee only: both requests still reached the handler before either
 *    one stored, so the handler's own side effects (e.g. a row insert) may
 *    already have happened twice. See "WHAT THIS DOES AND DOES NOT PROTECT
 *    AGAINST" above.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  // Explicit @Inject(): tsx does not reliably emit design:paramtypes, so a
  // bare-typed constructor param can silently resolve to undefined — the
  // same hazard every other Nest provider in this codebase documents.
  constructor(
    @Inject('IDEMPOTENCY_STORE') private readonly store: IdempotencyStore,
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = getHeader(req, 'idempotency-key');
    if (!key) return next.handle(); // no header -> do nothing at all, never invent one

    const orgId = this.orgs.requireOrgId();
    // `endpoint` (the route *pattern*) is stored/displayed only — a
    // human-readable label for which handler this key belongs to. Hashing
    // must use the concrete request path instead; see concreteRequestPath.
    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = hashRequest(req.method, concreteRequestPath(req), req.body);

    const existing = await this.store.find(orgId, key);
    if (existing) {
      return of(this.replay(context, existing, requestHash));
    }

    return of(await this.runAndStore(context, next, orgId, key, endpoint, requestHash));
  }

  /** Sets the response status to the stored one and returns the stored body — a true replay, not a re-derived one. */
  private replay(context: ExecutionContext, existing: IdempotencyRecord, requestHash: string): unknown {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used for a request with a different method, path, or body',
      );
    }
    const res = context.switchToHttp().getResponse<Response>();
    res.status(existing.responseStatus);
    return existing.responseBody;
  }

  private async runAndStore(
    context: ExecutionContext,
    next: CallHandler,
    orgId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<unknown> {
    let status: number;
    let body: unknown;
    try {
      body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      // Nest sets `res.statusCode` from @HttpCode()/default-per-method
      // metadata BEFORE the interceptor chain runs (RouterExecutionContext
      // calls `responseController.setStatus` ahead of
      // `interceptorsConsumer.intercept`), so it is already final here —
      // verified against a real POST route in task-11-report.md.
      status = context.switchToHttp().getResponse<Response>().statusCode;
    } catch (err) {
      // Decision 1: only cache responses below 500. A 500 is presumed
      // transient/infra — storing it would permanently block a retry from
      // ever succeeding. A deterministic 4xx (validation, conflict, etc.)
      // is safe and useful to cache: replaying it means the client doesn't
      // re-trigger the same failed write against the database.
      const httpStatus = err instanceof HttpException ? err.getStatus() : 500;
      if (httpStatus < 500) {
        await this.persist(orgId, key, endpoint, requestHash, httpStatus, errorBody(err, httpStatus));
      }
      throw err;
    }

    return this.persist(orgId, key, endpoint, requestHash, status, body ?? null);
  }

  private async persist(
    orgId: string,
    key: string,
    endpoint: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<unknown> {
    const result = await this.store.create({ orgId, key, endpoint, requestHash, responseStatus, responseBody });
    if (result.won) return responseBody;

    // Decision 2: lost the race to store first. If the winner's stored
    // request hash doesn't match ours, this was two *different* requests
    // racing on the same key — a genuine client bug, surfaced the same way
    // a non-racing hit-with-different-hash would be.
    if (result.existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used for a request with a different method, path, or body',
      );
    }
    // Same request, benign race: the winner's stored response is now the
    // canonical answer for this key — return it instead of our own, so
    // every caller using this key ends up seeing one consistent outcome.
    return result.existing.responseBody;
  }
}

function errorBody(err: unknown, status: number): unknown {
  if (err instanceof HttpException) return err.getResponse();
  return { statusCode: status, message: err instanceof Error ? err.message : 'Internal error' };
}

/**
 * Tenant-scoped `IdempotencyKey` reads/writes, forced-RLS via `withOrg` —
 * same shape as every other tenant-table access in this codebase. Not
 * `PrismaPlanStore`/`PrismaAuthStore`'s BYPASSRLS platform client: an
 * idempotency record only ever needs to be visible to the org that created
 * it, and by the time this store runs, `OrgContextService.requireOrgId()`
 * has already resolved a real tenant, so there's no "no session yet"
 * chicken-and-egg problem those two classes exist to work around.
 */
export class PrismaIdempotencyStore implements IdempotencyStore {
  async find(orgId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = await withOrg(orgId, (tx: LibraryTx) =>
      tx.idempotencyKey.findUnique({ where: { orgId_key: { orgId, key } } }),
    );
    return row
      ? { requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody }
      : null;
  }

  async create(row: NewIdempotencyRecord): Promise<CreateResult> {
    const body: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      row.responseBody === null || row.responseBody === undefined
        ? Prisma.JsonNull
        : (row.responseBody as Prisma.InputJsonValue);
    try {
      await withOrg(row.orgId, (tx: LibraryTx) =>
        tx.idempotencyKey.create({
          data: {
            orgId: row.orgId,
            key: row.key,
            endpoint: row.endpoint,
            requestHash: row.requestHash,
            responseStatus: row.responseStatus,
            responseBody: body,
          },
        }),
      );
      return { won: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.find(row.orgId, row.key);
        // The row that just caused our unique-constraint violation must
        // exist by the time we look it up again — `create` only reaches
        // this catch after Postgres itself reports the conflict.
        if (existing) return { won: false, existing };
      }
      throw err;
    }
  }
}
