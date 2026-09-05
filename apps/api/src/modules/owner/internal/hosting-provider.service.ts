import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';

/**
 * Attaching a school's own domain to the host that actually serves it.
 *
 * DNS is only half the job, and the half that fails silently. A hostname whose
 * CNAME points at Vercel but which no project claims is answered by the edge
 * with `DEPLOYMENT_NOT_FOUND`, and no certificate is ever issued for it — so
 * the school sees a TLS warning rather than their site, and every DNS checker
 * they consult tells them the record is correct. That was the state of
 * `sample.trackyour.in`: right IPs, no project, permanently broken.
 *
 * This service is deliberately the ONLY place that knows the host is Vercel.
 * Everything above it speaks in `attach` / `detach` / `status`, so moving to
 * AWS later is a new implementation of this interface plus a re-pointed
 * INGRESS_CNAME_TARGET — not a change to the domain flow or to any school's
 * DNS.
 */

export type HostingStatus =
  /** Attached, certificate issued, serving. */
  | { state: 'ready' }
  /** Attached, but the host says DNS does not point at it yet. */
  | { state: 'misconfigured'; detail: string }
  /** Not attached to the project at all. */
  | { state: 'not_attached' }
  /** We have no credentials, so we genuinely do not know. */
  | { state: 'unknown'; detail: string };

const API = 'https://api.vercel.com';

@Injectable()
export class HostingProviderService {
  private readonly logger = new Logger(HostingProviderService.name);
  private readonly env = loadEnv();

  /**
   * The project a school's domain must be attached to: the one that serves
   * school websites, NOT the one this code happens to run in.
   *
   * Reading VERCEL_PROJECT_ID here attached raffles.sckools.com to the API
   * project on 5 Sept 2026 and 404'd that school's site in production — the
   * API answers no route for `/`, so every page returned
   * {"code":"NOT_FOUND","message":"Cannot GET /"}. Vercel injects
   * VERCEL_PROJECT_ID as the id of whichever project is asking, so on a split
   * web/api deployment it is always the wrong answer here.
   */
  private get webProjectId(): string | undefined {
    return this.env.VERCEL_WEB_PROJECT_ID;
  }

  /**
   * False when credentials are absent — callers surface a manual step instead.
   *
   * Requires VERCEL_WEB_PROJECT_ID specifically. Falling back to
   * VERCEL_PROJECT_ID would re-create the outage silently, so an environment
   * that sets only the token reports "not configured" and the operator attaches
   * by hand, which is the safe half of the old behaviour.
   */
  get configured(): boolean {
    return Boolean(this.env.VERCEL_TOKEN && this.webProjectId);
  }

  private url(path: string): string {
    const team = this.env.VERCEL_TEAM_ID;
    return `${API}${path}${team ? `${path.includes('?') ? '&' : '?'}teamId=${team}` : ''}`;
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string; message: string }> {
    const res = await fetch(this.url(path), {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.env.VERCEL_TOKEN}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      // A slow hosting API must not hold the operator's request open forever.
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string; message?: string };
      return {
        ok: false,
        status: res.status,
        code: err.code ?? 'unknown',
        message: err.message ?? `Vercel responded ${res.status}`,
      };
    }
    return { ok: true, data: json as T };
  }

  /**
   * Claims `hostname` for the project, and `www.<hostname>` alongside it.
   *
   * A school hands us stmarys.edu.in and their registrar almost always has a
   * `www` record pointing at it too. Attaching only the apex leaves
   * www.stmarys.edu.in resolving to us and answering 404 — the Domain row says
   * `stmarys.edu.in`, so the www form matches no tenant. That is a dead address
   * on the school's own letterhead, and nobody discovers it until a parent
   * types it.
   *
   * The www copy is registered as a REDIRECT to the apex rather than a second
   * live host, which is how the platform's own www.sckools.com already behaves.
   * One canonical URL per school: better for search, and two hostnames serving
   * identical HTML would be two cache entries each earning half the hit rate.
   */
  async attach(hostname: string): Promise<{ ok: boolean; detail: string }> {
    const primary = await this.attachOne(hostname);
    // Best-effort, and deliberately not fatal: a school that never publishes a
    // www record loses nothing, and failing the whole add because the courtesy
    // alias could not be claimed would be the wrong trade.
    if (primary.ok && !hostname.startsWith('www.')) {
      await this.attachOne(`www.${hostname}`, hostname);
    }
    return primary;
  }

  /** Attach a single hostname; `redirectTo` makes it a redirect, not a site. */
  private async attachOne(hostname: string, redirectTo?: string): Promise<{ ok: boolean; detail: string }> {
    if (!this.configured) {
      return { ok: false, detail: 'Hosting credentials are not configured — attach the domain by hand.' };
    }
    const r = await this.call<{ name: string }>(
      `/v10/projects/${this.webProjectId}/domains`,
      {
        method: 'POST',
        // gitBranch pins the domain to a branch's latest deployment. Omitted
        // (undefined) it means production, which is what we want in prod and
        // exactly what we must NOT do on staging — see VERCEL_GIT_BRANCH.
        body: {
          name: hostname,
          ...(this.env.VERCEL_GIT_BRANCH ? { gitBranch: this.env.VERCEL_GIT_BRANCH } : {}),
          ...(redirectTo ? { redirect: redirectTo, redirectStatusCode: 308 } : {}),
        },
      },
    );
    if (r.ok) {
      const where = this.env.VERCEL_GIT_BRANCH ? ` (branch ${this.env.VERCEL_GIT_BRANCH})` : '';
      this.logger.log(`Attached ${hostname} to project ${this.webProjectId}${where}`);
      return { ok: true, detail: `${hostname} attached to the hosting project${where}.` };
    }
    if (r.code === 'domain_already_in_use' || r.status === 409) {
      // Already ours (re-run) or held by another account. `status` tells the
      // two apart on the next call; either way we do not want to fail `add`.
      return { ok: true, detail: `${hostname} is already claimed — checking which project holds it.` };
    }
    this.logger.warn(`Attach ${hostname} failed: ${r.code} ${r.message}`);
    return { ok: false, detail: r.message };
  }

  /** Releases the hostname and its www alias, so neither stays claimed by us. */
  async detach(hostname: string): Promise<void> {
    if (!this.configured) return;
    if (!hostname.startsWith('www.')) await this.detachOne(`www.${hostname}`);
    await this.detachOne(hostname);
  }

  private async detachOne(hostname: string): Promise<void> {
    const r = await this.call(
      `/v9/projects/${this.webProjectId}/domains/${encodeURIComponent(hostname)}`,
      { method: 'DELETE' },
    );
    // Best-effort: a domain removed from the platform but left on the host is
    // an orphan, not a data risk, and must not block the operator's delete.
    if (!r.ok && r.status !== 404) {
      this.logger.warn(`Detach ${hostname} failed: ${r.code} ${r.message}`);
    }
  }

  /** What the host itself believes about this domain, right now. */
  async status(hostname: string): Promise<HostingStatus> {
    if (!this.configured) {
      return { state: 'unknown', detail: 'Hosting credentials are not configured.' };
    }
    const r = await this.call<{ verified: boolean; misconfigured?: boolean }>(
      `/v9/projects/${this.webProjectId}/domains/${encodeURIComponent(hostname)}/config`,
      { method: 'GET' },
    );
    if (!r.ok) {
      if (r.status === 404) return { state: 'not_attached' };
      return { state: 'unknown', detail: r.message };
    }
    if (r.data.misconfigured) {
      return {
        state: 'misconfigured',
        detail: 'The hosting project has the domain, but does not yet see the DNS record pointing at it.',
      };
    }
    return { state: 'ready' };
  }
}
