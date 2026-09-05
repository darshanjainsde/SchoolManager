import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

/**
 * What a school's public homepage actually costs a visitor, measured now.
 *
 * The speed work of Sept 2026 turned the CDN on for school sites, and the
 * whole point of it is invisible from inside the product: a page either came
 * from the edge or re-ran eleven database queries, and nothing in the console
 * ever said which. That is how it stayed broken for months — every public URL
 * answered `x-vercel-cache: MISS` and no operator had a reason to look.
 *
 * So this measures the real thing over the real network rather than reporting
 * a number the app believes about itself: fetch each LIVE school's homepage on
 * the host a parent would type, and report the time to first byte, the bytes,
 * and whether the edge served it.
 */

export interface SchoolSpeedRow {
  schoolId: string;
  name: string;
  host: string;
  /** null when the request failed outright — see `error`. */
  ttfbMs: number | null;
  bytes: number | null;
  status: number | null;
  /** HIT / MISS / STALE / PRERENDER, or null when the header is absent. */
  edgeCache: string | null;
  /** True when the response may be held by a shared cache at all. */
  cacheable: boolean;
  error: string | null;
}

export interface SpeedReport {
  measuredAt: string;
  /** Where the measurement ran from, because it changes what the numbers mean. */
  vantage: string;
  rows: SchoolSpeedRow[];
}

@Injectable()
export class SpeedService {
  private readonly logger = new Logger(SpeedService.name);
  private readonly env = loadEnv();
  /** Measuring is a network call per school; do not re-run it on every page view. */
  private cached: { at: number; report: SpeedReport } | null = null;
  private static readonly TTL_MS = 60_000;

  async report(force = false): Promise<SpeedReport> {
    if (!force && this.cached && Date.now() - this.cached.at < SpeedService.TTL_MS) {
      return this.cached.report;
    }
    const report = await this.measure();
    this.cached = { at: Date.now(), report };
    return report;
  }

  private async measure(): Promise<SpeedReport> {
    const db = getPlatformPrisma();
    const schools = await db.school.findMany({
      where: { status: 'LIVE' },
      select: {
        id: true,
        name: true,
        slug: true,
        domains: { where: { status: 'LIVE', isPrimary: true }, select: { hostname: true }, take: 1 },
      },
      orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
      schools.map((s) =>
        // A school is measured on the address it actually publishes: its own
        // domain when it has one, otherwise the platform subdomain.
        this.probe(s.id, s.name, s.domains[0]?.hostname ?? `${s.slug}.${this.env.PLATFORM_HOST}`),
      ),
    );

    return {
      measuredAt: new Date().toISOString(),
      vantage: process.env.VERCEL_REGION ?? 'server',
      rows,
    };
  }

  private async probe(schoolId: string, name: string, host: string): Promise<SchoolSpeedRow> {
    const base: SchoolSpeedRow = {
      schoolId, name, host,
      ttfbMs: null, bytes: null, status: null, edgeCache: null, cacheable: false, error: null,
    };
    const started = Date.now();
    try {
      const res = await fetch(`https://${host}/`, {
        // The point is to observe the shared cache, not to bypass it.
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      // Headers arrive before the body, so this is the closest a server-side
      // fetch gets to time-to-first-byte.
      const ttfbMs = Date.now() - started;
      const body = await res.arrayBuffer();
      const cc = res.headers.get('cache-control') ?? '';
      return {
        ...base,
        ttfbMs,
        bytes: body.byteLength,
        status: res.status,
        edgeCache: res.headers.get('x-vercel-cache'),
        // `no-store` / `private` means no shared cache may hold it — which was
        // the state of every public page before the caching work.
        cacheable: /max-age|s-maxage/.test(cc) && !/no-store|private/.test(cc),
      };
    } catch (e) {
      this.logger.warn(`Speed probe failed for ${host}: ${(e as Error).message}`);
      return { ...base, error: (e as Error).message };
    }
  }
}
