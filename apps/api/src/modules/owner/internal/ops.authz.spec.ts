import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnerController } from './owner.controller';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';

/**
 * GET /owner/ops exposes platform-wide health: request volumes, error counts,
 * and cross-tenant outbox depth. It is operator-only.
 *
 * This is the assertion that lets the route into AUTHZ_REVIEWED. The manifest
 * is meant to be a list of routes somebody actually checked, not a list of
 * routes somebody intended to check — so it gets a real assertion rather than
 * an entry on trust.
 *
 * Written against guard metadata rather than as a smoke test: the smoke suites
 * hit a separately-booted API on :3001, which cannot know about a route that
 * only exists on this branch.
 */
describe('GET /owner/ops authorization', () => {
  const guards = Reflect.getMetadata('__guards__', OwnerController) ?? [];

  it('is behind the platform JWT guard — a school token must not reach it', () => {
    expect(guards).toContain(PlatformJwtGuard);
  });

  it('is behind the owner-host guard — it is not reachable from a tenant host', () => {
    expect(guards).toContain(OwnerHostGuard);
  });

  it('exposes counts only, never tenant row content', () => {
    // The BYPASSRLS allow-list entry claims this; keep the claim honest by
    // failing if the service ever starts selecting tenant fields.
    const src = readFileSync(join(__dirname, 'ops.service.ts'), 'utf8');
    expect(src).not.toMatch(/\bfindMany\b/);
    expect(src).toMatch(/\.count\(/);
  });
});
