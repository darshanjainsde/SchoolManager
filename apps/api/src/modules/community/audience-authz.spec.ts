import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventsController } from './events.controller';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';

/**
 * GET /manage/events/audience-candidates lists other schools so a teacher can
 * address an event to them. It is cross-tenant by purpose, so it must be
 * reachable only by a signed-in school user — never anonymously.
 *
 * This is the assertion that earns the route its place in AUTHZ_REVIEWED.
 */
describe('GET /manage/events/audience-candidates authorization', () => {
  it('is behind the school JWT guard — never anonymous', () => {
    const guards = Reflect.getMetadata('__guards__', EventsController) ?? [];
    expect(guards).toContain(SchoolJwtGuard);
  });

  it('resolves the caller school from the token, never from a request parameter', () => {
    const src = readFileSync(join(__dirname, 'events.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async audienceCandidates'), src.indexOf('async create('));
    // A schoolId taken from the query string would let anyone enumerate as
    // anyone; it must come from the tenant context.
    expect(fn).toContain('this.tenant.requireTenant()');
  });
});
