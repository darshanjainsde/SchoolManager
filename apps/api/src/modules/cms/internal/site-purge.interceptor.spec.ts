import { of, throwError, lastValueFrom } from 'rxjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SitePurgeInterceptor } from './site-purge.interceptor';
import type { TenantContextService } from '../../tenancy';

function ctx(method: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ method }) }) } as unknown as Parameters<
    SitePurgeInterceptor['intercept']
  >[0];
}

function make(tenant: unknown, env: Record<string, string> = {}) {
  const i = new SitePurgeInterceptor({ get: () => tenant } as unknown as TenantContextService);
  (i as unknown as { env: Record<string, string> }).env = env;
  const purged: string[] = [];
  (i as unknown as { purge: unknown }).purge = async (id: string) => {
    purged.push(id);
  };
  return { i, purged };
}

const TENANT = { kind: 'tenant', schoolId: 'sch-1', schoolSlug: 'stmarys', hostname: 'x' };
const handler = { handle: () => of({ ok: true }) };

describe('SitePurgeInterceptor', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('purges after a %s', async (m) => {
    const { i, purged } = make(TENANT);
    await lastValueFrom(await i.intercept(ctx(m), handler));
    expect(purged).toEqual(['sch-1']);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not purge on a %s', async (m) => {
    const { i, purged } = make(TENANT);
    await lastValueFrom(await i.intercept(ctx(m), handler));
    expect(purged).toEqual([]);
  });

  // A write that threw changed nothing, so there is nothing to drop.
  it('does not purge when the write failed', async () => {
    const { i, purged } = make(TENANT);
    const failing = { handle: () => throwError(() => new Error('constraint')) };
    await expect(lastValueFrom(await i.intercept(ctx('POST'), failing))).rejects.toThrow();
    expect(purged).toEqual([]);
  });

  it('does nothing without a tenant, rather than guessing whose cache to drop', async () => {
    for (const t of [null, { kind: 'platform', hostname: 'x' }]) {
      const { i, purged } = make(t);
      await lastValueFrom(await i.intercept(ctx('POST'), handler));
      expect(purged).toEqual([]);
    }
  });

  it('passes the handler result through untouched', async () => {
    const body = { id: 'a' };
    const { i } = make(TENANT);
    const out = await lastValueFrom(await i.intercept(ctx('POST'), { handle: () => of(body) }));
    expect(out).toBe(body);
  });
});

/**
 * The interceptor is worth nothing on a controller that does not carry it, and
 * a new site/* controller added without it would silently reintroduce the
 * stale-page bug. Every test above would still pass.
 */
describe('every site/* controller', () => {
  const dir = __dirname;
  const controllers = readdirSync(dir)
    .filter((f) => f.endsWith('.controller.ts') && !f.includes(' 2.'))
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes("@Controller('site"));

  it('has controllers to check', () => {
    expect(controllers.length).toBeGreaterThan(5);
  });

  it('applies the purge interceptor', () => {
    const missing = controllers.filter(
      (f) => !/@UseInterceptors\(\s*SitePurgeInterceptor\s*\)/.test(readFileSync(join(dir, f), 'utf8')),
    );
    expect(missing).toEqual([]);
  });
});
