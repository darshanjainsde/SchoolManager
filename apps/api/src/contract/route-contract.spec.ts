import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkSurface,
  duplicateRoutes,
  mobileSurface,
  scanClientCalls,
  scanServer,
  shadowedRoutes,
  webSurface,
  type Surface,
} from './route-contract';

/**
 * Calls that are refused ON PURPOSE. Each entry is `KIND VERB path @ file` and
 * must say why; an entry that stops matching fails the suite, so this list
 * can only describe the code as it is.
 */
const INTENDED: Record<string, string> = {
  // The public event sign-up asks /me/profile to tell a signed-in pupil from
  // everyone else; a refusal is its "no pupil here, use the guest form" answer.
  // It is reached from the alumni pages, whose ALUMNUS login is refused by design.
  'ROLE_REFUSED GET /me/profile @ apps/web/components/public/registration-client.ts':
    'probe: refusal means "not a pupil" (see probeSignedIn)',
};

const key = (f: { kind: string; call: string; where: string }) => `${f.kind} ${f.call} @ ${f.where.replace(/:\d+$/, '')}`;

describe('route contract — this repository', () => {
  const { routes, unreadable } = scanServer();

  it('reads a real route table (a scanner that finds nothing passes everything)', () => {
    expect(routes.length).toBeGreaterThan(500);
    expect(routes.filter((r) => r.roles?.includes('STUDENT')).length).toBeGreaterThan(30);
  });

  it('understands every controller and @Roles it meets', () => {
    // A `@Roles(...SOME_LIST)` or computed path cannot be checked; write it literally.
    expect(unreadable).toEqual([]);
  });

  it('declares every verb + path exactly once', () => {
    expect(duplicateRoutes(routes)).toEqual([]);
  });

  it('never declares a :param route above a static sibling it would swallow', () => {
    expect(shadowedRoutes(routes)).toEqual([]);
  });

  it.each([
    ['the mobile app', mobileSurface(), 150],
    ['the web portals', webSurface(), 600],
  ])('%s only calls routes its role may use', (_name, surface, minCalls) => {
    const { findings, calls } = checkSurface(surface, routes);
    expect(calls).toBeGreaterThan(minCalls);
    const unexpected = findings.filter((f) => !INTENDED[key(f)]);
    // Each line: what was called, from where, and which controller refused it.
    expect(unexpected.map((f) => `${f.kind} ${f.call} @ ${f.where} — ${f.detail}`)).toEqual([]);
  });

  it('keeps no stale entry in the intended-refusal list', () => {
    const all = [mobileSurface(), webSurface()].flatMap((s) => checkSurface(s, routes).findings.map(key));
    expect(Object.keys(INTENDED).filter((k) => !all.includes(k))).toEqual([]);
  });

  it('pins the two doors that broke on 2026-10-06', () => {
    const profile = routes.filter((r) => r.verb === 'GET' && r.path === '/me/profile');
    expect(profile.map((r) => [r.controller, r.roles])).toEqual([['PortalController', ['STUDENT']]]);
    const bell = routes.find((r) => r.verb === 'GET' && r.path === '/me/notifications/unread-count');
    expect(bell?.roles).toEqual(expect.arrayContaining(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'STAFF']));
  });
});

// ── The scanner itself, on fixtures: each edge case it must read as code ────

describe('route contract — scanner edge cases', () => {
  let dir: string;
  const write = (rel: string, body: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-contract-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const server = () => scanServer(path.join(dir, 'api'));

  it('reads class @Roles, method overrides, UserRole.X, object paths and bare @Get()', () => {
    write('api/a.controller.ts', `
      @Roles('STUDENT') @Controller('me')
      export class A {
        @Get('home') home() {}
        @Roles('STUDENT', UserRole.TEACHER) @Post('push-token') push() {}
      }
      @Controller({ path: 'me/fees' })
      export class B { @Get() list() {} @Delete(':id') del() {} }
    `);
    const { routes, unreadable } = server();
    expect(unreadable).toEqual([]);
    expect(routes.map((r) => `${r.verb} ${r.path} ${r.roles?.join('+') ?? 'any'}`)).toEqual([
      'GET /me/home STUDENT',
      'POST /me/push-token STUDENT+TEACHER',
      'GET /me/fees any',
      'DELETE /me/fees/:id any',
    ]);
  });

  it('flags a @Roles it cannot read instead of guessing', () => {
    write('api/a.controller.ts', `@Roles(...STAFF) @Controller('x') export class A { @Get() g() {} }`);
    expect(server().unreadable).toHaveLength(1);
  });

  it('finds the same verb + path in two controllers, even with differently named params', () => {
    write('api/a.controller.ts', `@Controller('me/profile') export class A { @Get() g() {} @Get(':id') one() {} }`);
    write('api/b.controller.ts', `@Controller('me') export class B { @Get('profile') g() {} @Get('profile/:userId') one() {} @Post('profile') p() {} }`);
    const dups = duplicateRoutes(server().routes);
    expect(dups).toHaveLength(2);
    expect(dups[0]).toContain('GET /me/profile');
  });

  it('finds a :param declared above the static path it swallows — but not the reverse', () => {
    write('api/a.controller.ts', `@Controller('leave') export class A { @Get(':id') one() {} @Get('mine') mine() {} }`);
    write('api/b.controller.ts', `@Controller('fees') export class B { @Get('mine') mine() {} @Get(':id') one() {} }`);
    expect(shadowedRoutes(server().routes)).toEqual(['GET /leave/:id is declared above /leave/mine in A']);
  });

  it('reads every client call shape the apps use', () => {
    const f = write('client/x.tsx', `
      const BASE = 'x';
      useQuery('/me/home?month=2026-10');
      api.request(\`/me/diary/\${id}/sign\`, { method: 'POST' });
      api.request(cond ? '/manage/a' : '/manage/b', { method: 'PATCH' });
      function add() { const p = mode ? '/manage/class-notes' : '/manage/class-todos'; api.request(p, { method: 'POST' }); }
      function get(p: string) { return api.request(p); }
      safeFetch(\`\${BASE}/auth/login\`, { method: 'POST' });
      probeApi
        .post('/auth/impersonate', {});
      api.del(\`/manage/x/\${a}\`);
      api.download('/manage/export');
      call('PUT', '/alumni/me', {});
      api.get(\`/manage/candidates\${q ? \`?q=\${q}\` : ''}\`);
      const el = <Card endpoint={\`/payroll/people/\${k}/\${id}/details\`} />;
      router.push('/teacher/inbox');
    `);
    expect(scanClientCalls([f]).map((c) => `${c.verb} ${c.path}`)).toEqual([
      'GET /me/home',
      'POST /me/diary/:p/sign',
      'PATCH /manage/a',
      'PATCH /manage/b',
      'POST /manage/class-notes',
      'POST /manage/class-todos',
      'POST /auth/login',
      'POST /auth/impersonate',
      'DELETE /manage/x/:p',
      'GET /manage/export',
      'PUT /alumni/me',
      'GET /manage/candidates~',
      'GET /payroll/people/:p/:p/details',
    ]);
  });

  function surface(): Surface {
    const src = path.join(dir, 'm/src');
    return {
      name: 'app',
      root: src,
      aliasRoot: src,
      groupOf: (f) => (f.includes(`${path.sep}(family)${path.sep}`) ? '(family)' : f.includes(`${path.sep}(worker)${path.sep}`) ? '(worker)' : null),
      groups: { '(family)': { roles: ['STUDENT'], mode: 'all' }, '(worker)': { roles: ['STAFF'], mode: 'all' } },
    };
  }

  it('reproduces 2026-10-06: a shared bell refused to one portal, a shadowed family door', () => {
    write('api/n.controller.ts', `@Roles('STUDENT', 'TEACHER') @Controller('me/notifications') export class N { @Get('unread-count') c() {} }`);
    // Mounted first (imported earlier) — and the scanner, like Express, takes the static match it meets first.
    write('api/a.controller.ts', `@Roles('TEACHER', 'STAFF') @Controller('me/profile') export class Staff { @Get() g() {} }`);
    write('m/src/lib/bell-api.ts', `export const count = () => api.request('/me/notifications/unread-count');`);
    write('m/src/components/Bell.tsx', `import { count } from '@/lib/bell-api'; export const Bell = () => null;`);
    write('m/src/app/(family)/home.tsx', `import { Bell } from '../../components/Bell'; useQuery('/me/profile');`);
    write('m/src/app/(worker)/today.tsx', `import { Bell } from '@/components/Bell';`);
    const { findings } = checkSurface(surface(), server().routes);
    expect(findings.map((f) => `${f.kind} ${f.call} ${f.where.split('/').pop()} ${f.detail.split(' signs')[0]}`).sort()).toEqual([
      'ROLE_REFUSED GET /me/notifications/unread-count bell-api.ts:1 app (worker)',
      'ROLE_REFUSED GET /me/profile home.tsx:1 app (family)',
    ]);
  });

  it('reports a call with no route at all, and ignores pre-login screens', () => {
    write('api/a.controller.ts', `@Controller('me') export class A { @Get('home') g() {} }`);
    write('m/src/app/(family)/x.tsx', `useQuery('/me/homee'); api.request('/me/home', { method: 'POST' });`);
    write('m/src/app/(auth)/login.tsx', `api.request('/nothing/here');`);
    const { findings } = checkSurface(surface(), server().routes);
    expect(findings.map((f) => `${f.kind} ${f.call}`)).toEqual(['NO_ROUTE GET /me/homee', 'NO_ROUTE POST /me/home']);
  });

  it('lets an "any" area through when one of its roles is allowed', () => {
    write('api/a.controller.ts', `@Roles('SCHOOL_ADMIN') @Controller('manage') export class A { @Get('x') g() {} }`);
    write('m/src/app/(family)/x.tsx', `useQuery('/manage/x');`);
    const s = surface();
    s.groups['(family)'] = { roles: ['STAFF', 'SCHOOL_ADMIN'], mode: 'any' };
    expect(checkSurface(s, server().routes).findings).toEqual([]);
  });
});
