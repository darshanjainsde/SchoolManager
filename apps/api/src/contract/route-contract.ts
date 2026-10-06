/**
 * The client ↔ server ROLE CONTRACT, read straight from source.
 *
 * Why this exists (2026-10-06): two controllers both declared `GET /me/profile`
 * — the family's (PortalController, STUDENT) and the staff page
 * (MeProfileController, admin/teacher/staff). Express hands a path to the
 * FIRST handler registered, AuthModule is imported before PortalModule, so
 * every student's Profile tab and Complaint Box answered "Role not permitted"
 * on prod. Separately, every staff desk's bell called `/me/notifications`,
 * whose controller never listed STAFF. Each side was tested — the app against
 * a mocked server, each controller on its own — and the one test that called
 * `/me/profile` as a student was a live-API smoke suite CI always skips.
 *
 * So the contract is checked statically, with no server and no database, on
 * every `pnpm test`:
 *
 *  1. every route is declared ONCE (same verb + same path shape), and inside a
 *     controller no `:param` route sits above a static sibling it would shadow;
 *  2. every API call the mobile app and the web portals make lands on a real
 *     route, and the role of the portal that makes it is allowed by that
 *     route's `@Roles` (method-level beats class-level, as RolesGuard reads it).
 *
 * Parsing uses the TypeScript compiler API rather than regexes, so decorators,
 * template-literal paths and `{ method: 'POST' }` options are read as code.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export type Verb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const VERBS: Record<string, Verb> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE' };

export interface ServerRoute {
  verb: Verb;
  /** `/me/fees/:id` — params kept by name for messages. */
  path: string;
  /** null = no `@Roles` anywhere: any signed-in role (or public) passes RolesGuard. */
  roles: string[] | null;
  controller: string;
  file: string;
  /** Declaration index inside its controller (Nest registers in this order). */
  order: number;
}

export interface ClientCall {
  verb: Verb;
  /** Normalised: query stripped, every `${…}` replaced by `:p`. */
  path: string;
  file: string;
  line: number;
}

const REPO = path.resolve(__dirname, '../../../..');
export const repoPath = (...p: string[]) => path.join(REPO, ...p);

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const parse = (file: string) =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const join = (...parts: string[]) => ('/' + parts.filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

function decoratorsOf(node: ts.Node): ts.Decorator[] {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined)?.slice() ?? [];
}

function callOf(d: ts.Decorator): { name: string; args: readonly ts.Expression[] } | null {
  const e = d.expression;
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) return null;
  return { name: e.expression.text, args: e.arguments };
}

function strings(e: ts.Expression | undefined): string[] | null {
  if (!e) return [''];
  if (ts.isStringLiteralLike(e)) return [e.text];
  if (ts.isArrayLiteralExpression(e)) {
    const all = e.elements.map((x) => (ts.isStringLiteralLike(x) ? x.text : null));
    return all.every((x): x is string => x !== null) ? all : null;
  }
  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'path') return strings(p.initializer);
    }
    return [''];
  }
  return null;
}

function rolesOf(decs: ts.Decorator[]): string[] | null | 'unreadable' {
  for (const d of decs) {
    const c = callOf(d);
    if (c?.name !== 'Roles') continue;
    const out: string[] = [];
    for (const a of c.args) {
      if (ts.isStringLiteralLike(a)) out.push(a.text);
      // `UserRole.SCHOOL_ADMIN` — the enum member's name IS the role.
      else if (ts.isPropertyAccessExpression(a) && a.expression.getText() === 'UserRole') out.push(a.name.text);
      else return 'unreadable';
    }
    return out;
  }
  return null;
}

/** Every route in apps/api, as Nest would register it. */
export function scanServer(root = repoPath('apps/api/src')): { routes: ServerRoute[]; unreadable: string[] } {
  const routes: ServerRoute[] = [];
  const unreadable: string[] = [];
  for (const file of walk(root, (f) => f.endsWith('.controller.ts'))) {
    const sf = parse(file);
    sf.forEachChild((node) => {
      if (!ts.isClassDeclaration(node) || !node.name) return;
      const decs = decoratorsOf(node);
      const ctrl = decs.map(callOf).find((c) => c?.name === 'Controller');
      if (!ctrl) return;
      const bases = strings(ctrl.args[0]);
      const classRoles = rolesOf(decs);
      if (!bases || classRoles === 'unreadable') {
        unreadable.push(`${node.name.text} (${path.relative(REPO, file)})`);
        return;
      }
      let order = 0;
      for (const m of node.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        const mdecs = decoratorsOf(m);
        const methodRoles = rolesOf(mdecs);
        if (methodRoles === 'unreadable') {
          unreadable.push(`${node.name.text}.${m.name.getText()} (${path.relative(REPO, file)})`);
          continue;
        }
        for (const d of mdecs) {
          const c = callOf(d);
          const verb = c && VERBS[c.name];
          if (!c || !verb) continue;
          const subs = strings(c.args[0]);
          if (!subs) {
            unreadable.push(`${node.name.text}.${m.name.getText()} (${path.relative(REPO, file)})`);
            continue;
          }
          for (const b of bases) for (const s of subs) {
            routes.push({
              verb,
              path: join(b, s),
              roles: methodRoles ?? classRoles,
              controller: node.name.text,
              file: path.relative(REPO, file),
              order: order++,
            });
          }
        }
      }
    });
  }
  return { routes, unreadable };
}

const shape = (p: string) => p.replace(/:[^/]+/g, ':p');

/** Two handlers for one verb+path: only the first registered ever runs. */
export function duplicateRoutes(routes: ServerRoute[]): string[] {
  const by = new Map<string, ServerRoute[]>();
  for (const r of routes) {
    const k = `${r.verb} ${shape(r.path)}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .filter(([, rs]) => new Set(rs.map((r) => r.controller + r.path)).size > 1)
    .map(([k, rs]) => `${k} ← ${rs.map((r) => `${r.controller} [${r.roles?.join(',') ?? 'any'}]`).join(' AND ')}`);
}

/** In ONE controller, `GET :id` declared above `GET mine` swallows `mine`. */
export function shadowedRoutes(routes: ServerRoute[]): string[] {
  const out: string[] = [];
  for (const a of routes) for (const b of routes) {
    if (a.controller !== b.controller || a.file !== b.file || a.verb !== b.verb || a.order >= b.order) continue;
    const sa = a.path.split('/');
    const sb = b.path.split('/');
    if (sa.length !== sb.length || a.path === b.path) continue;
    const swallows = sa.every((seg, i) => seg === sb[i] || (seg.startsWith(':') && !sb[i].startsWith(':')));
    if (swallows) out.push(`${a.verb} ${a.path} is declared above ${b.path} in ${a.controller}`);
  }
  return out;
}

// ── Clients ─────────────────────────────────────────────────────────────────

/**
 * Every literal path an argument can evaluate to: a string or template, either
 * arm of `cond ? '/a' : '/b'`, or a `const` declared with one in the same file.
 */
function pathsOf(e: ts.Expression, sf: ts.SourceFile, depth = 0): string[] {
  if (depth > 3) return [];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return pathsOf(e.expression, sf, depth + 1);
  if (ts.isConditionalExpression(e)) return [...pathsOf(e.whenTrue, sf, depth + 1), ...pathsOf(e.whenFalse, sf, depth + 1)];
  if (ts.isIdentifier(e)) return constPaths(e, sf, depth);
  const one = pathOf(e);
  return one ? [one] : [];
}

/**
 * Scope-aware: walks up from the use, stops at a function that takes a
 * parameter of that name (then it is caller-supplied, not a literal), and reads
 * a `const` declared directly in an enclosing block.
 */
function constPaths(id: ts.Identifier, sf: ts.SourceFile, depth: number): string[] {
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n) && n.parameters.some((prm) => ts.isIdentifier(prm.name) && prm.name.text === id.text)) return [];
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      for (const st of n.statements) {
        if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer) return pathsOf(d.initializer, sf, depth + 1);
        }
      }
    }
  }
  return [];
}

/** Turns a path argument into `/a/:p/b`, or null when it is not a literal path. */
function pathOf(e: ts.Expression): string | null {
  let raw: string;
  if (ts.isStringLiteralLike(e)) raw = e.text;
  else if (ts.isTemplateExpression(e)) {
    raw = e.head.text;
    for (const span of e.templateSpans) {
      // `${BASE}/auth/login` — the base URL is not part of the path.
      const isBase = raw === '' && /^(BASE|base|API|apiBase|API_BASE)$/.test(span.expression.getText());
      raw += (isBase ? '' : '\u0000') + span.literal.text;
    }
  } else return null;
  raw = raw.split('?')[0].split('#')[0];
  if (!raw.startsWith('/')) return null;
  // A template span inside a segment makes the whole segment a parameter.
  return raw
    .split('/')
    // `/x/${id}` → `:p`. `/candidates${q ? '?q=…' : ''}` → `candidates~`: the
    // span may be a query, so the segment matches its static prefix OR a param.
    .map((seg) => {
      if (!seg.includes('\u0000')) return seg;
      const prefix = seg.slice(0, seg.indexOf('\u0000'));
      return prefix && seg.endsWith('\u0000') && seg.indexOf('\u0000') === seg.lastIndexOf('\u0000') ? `${prefix}~` : ':p';
    })
    .join('/')
    .replace(/(.)\/$/, '$1');
}

function verbFromOptions(e: ts.Expression | undefined): Verb {
  if (e && ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'method' && ts.isStringLiteralLike(p.initializer)) {
        const v = p.initializer.text.toUpperCase();
        if (v === 'GET' || v === 'POST' || v === 'PUT' || v === 'PATCH' || v === 'DELETE') return v;
      }
    }
  }
  return 'GET';
}

const WEB_VERB: Record<string, Verb> = { get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', del: 'DELETE', delete: 'DELETE', postForm: 'POST', upload: 'POST', download: 'GET' };

/** Every API call in a set of client files. */
export function scanClientCalls(files: string[]): ClientCall[] {
  const out: ClientCall[] = [];
  for (const file of files) {
    const sf = parse(file);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.arguments.length > 0) {
        const callee = n.expression.getText(sf).replace(/\s+/g, '');
        // `call('GET', '/alumni/me', …)` — the verb rides first, the path second.
        const verbFirst = /^(call|send)$/.test(callee) && ts.isStringLiteralLike(n.arguments[0]) && n.arguments.length > 1;
        const pathArg = verbFirst ? n.arguments[1] : n.arguments[0];
        const ps = pathsOf(pathArg, sf);
        let verb: Verb | null = null;
        if (ps.length > 0) {
          if (verbFirst) {
            const v = (n.arguments[0] as ts.StringLiteralLike).text.toUpperCase();
            verb = v === 'GET' || v === 'POST' || v === 'PUT' || v === 'PATCH' || v === 'DELETE' ? v : null;
          } else if (/(^|\.)request$/.test(callee) && /api|client|this/i.test(callee)) verb = verbFromOptions(n.arguments[1]);
          else if (/^(useQuery|fetchCached|useDeskQuery)$/.test(callee)) verb = 'GET';
          else if (/^safeFetch$|^fetch$/.test(callee)) verb = verbFromOptions(n.arguments[1]);
          else {
            const m = /^(?:\w*[aA]pi|this|client)\.(\w+)$/.exec(callee);
            if (m && WEB_VERB[m[1]]) verb = WEB_VERB[m[1]];
          }
        }
        if (verb) {
          const line = sf.getLineAndCharacterOfPosition(pathArg.getStart(sf)).line + 1;
          for (const one of new Set(ps)) out.push({ verb, path: one, file: path.relative(REPO, file), line });
        }
      }
      // `<PayDetailsCard endpoint={`/payroll/people/${kind}/${id}/details`} />` — a GET by convention.
      if (ts.isJsxAttribute(n) && /^(endpoint|path|url)$/.test(n.name.getText(sf)) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        for (const one of new Set(pathsOf(n.initializer.expression, sf))) out.push({ verb: 'GET', path: one, file: path.relative(REPO, file), line });
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return out;
}

/** Route that would serve this call (first registered wins, as in Express). */
export function routeFor(call: ClientCall, routes: ServerRoute[]): ServerRoute | null {
  const cs = call.path.split('/');
  const fits = (r: ServerRoute) => {
    if (r.verb !== call.verb) return false;
    const rs = r.path.split('/');
    return rs.length === cs.length && rs.every((seg, i) => {
      const c = cs[i];
      if (c.endsWith('~')) return seg === c.slice(0, -1) || seg.startsWith(':');
      return seg === c || seg.startsWith(':') || c === ':p';
    });
  };
  // Prefer an exact static match over a param route, as a real request would.
  const hits = routes.filter(fits);
  return hits.find((r) => r.path === call.path) ?? hits.find((r) => !r.path.includes(':')) ?? hits[0] ?? null;
}

// ── Who reaches a client file ───────────────────────────────────────────────

const EXT = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveImport(from: string, spec: string, aliasRoot: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(aliasRoot, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const e of EXT) if (fs.existsSync(base + e)) return base + e;
  return null;
}

/**
 * For each file, the set of portals ("entry groups") that can reach it through
 * imports. An entry group is decided by `groupOf(file)` on route files.
 */
export function reachability(files: string[], aliasRoot: string, groupOf: (f: string) => string | null): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>();
  for (const f of files) {
    const sf = parse(f);
    sf.forEachChild((n) => {
      const spec =
        (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)
          ? n.moduleSpecifier.text
          : null;
      if (!spec) return;
      const to = resolveImport(f, spec, aliasRoot);
      if (to) importers.set(to, new Set([...(importers.get(to) ?? []), f]));
    });
  }
  // Plain BFS up the importer graph from each file: every entry group above it.
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    const groups = new Set<string>();
    const seen = new Set([f]);
    const queue = [f];
    while (queue.length) {
      const cur = queue.shift()!;
      const own = groupOf(cur);
      if (own) {
        groups.add(own);
        continue; // a route file is an entry; what imports it is another route's business
      }
      for (const imp of importers.get(cur) ?? []) if (!seen.has(imp)) { seen.add(imp); queue.push(imp); }
    }
    out.set(f, groups);
  }
  return out;
}

export interface Surface {
  name: string;
  /** Root folder (absolute) and the `@/` alias root. */
  root: string;
  aliasRoot: string;
  /** Entry group of a file, or null for shared code. */
  groupOf: (absFile: string) => string | null;
  /**
   * Roles each group signs in as. `all` = every role must be allowed (one
   * portal, one role); `any` = the area serves several roles and gates pages
   * itself, so at least one must be allowed.
   */
  groups: Record<string, { roles: string[]; mode: 'all' | 'any' }>;
}

export interface Finding {
  kind: 'NO_ROUTE' | 'ROLE_REFUSED';
  call: string;
  where: string;
  detail: string;
}

export function checkSurface(s: Surface, routes: ServerRoute[]): { findings: Finding[]; calls: number } {
  const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/(__tests__|\.test\.|\.spec\.|__mocks__|\.d\.ts$)/.test(f);
  const files = walk(s.root, isSource);
  const reach = reachability(files, s.aliasRoot, s.groupOf);
  const calls = scanClientCalls(files);
  const findings: Finding[] = [];
  for (const c of calls) {
    const groups = [...(reach.get(path.join(REPO, c.file)) ?? [])].filter((g) => s.groups[g]);
    if (groups.length === 0) continue; // pre-login screens and dead code: no signed-in role.
    const r = routeFor(c, routes);
    const where = `${c.file}:${c.line}`;
    if (!r) {
      findings.push({ kind: 'NO_ROUTE', call: `${c.verb} ${c.path}`, where, detail: `no ${c.verb} route has this shape (reached from ${groups.join(', ')})` });
      continue;
    }
    if (!r.roles) continue;
    for (const g of groups) {
      const { roles, mode } = s.groups[g];
      const ok = mode === 'all' ? roles.every((x) => r.roles!.includes(x)) : roles.some((x) => r.roles!.includes(x));
      if (!ok) {
        findings.push({
          kind: 'ROLE_REFUSED',
          call: `${c.verb} ${c.path}`,
          where,
          detail: `${s.name} ${g} signs in as ${roles.join('/')}, but ${r.controller} (${r.path}) allows only ${r.roles.join(', ')}`,
        });
      }
    }
  }
  return { findings, calls: calls.length };
}

const inDir = (root: string, dir: string) => (f: string) => f.startsWith(path.join(root, dir) + path.sep);

/** The Expo app: one portal folder per role (see apps/mobile/src/lib/roles.ts). */
export function mobileSurface(): Surface {
  const src = repoPath('apps/mobile/src');
  const app = path.join(src, 'app');
  return {
    name: 'app',
    root: src,
    aliasRoot: src,
    groupOf: (f) =>
      inDir(app, '(family)')(f) ? '(family)' : inDir(app, '(staff)')(f) ? '(staff)' : inDir(app, '(worker)')(f) ? '(worker)' : inDir(app, '(auth)')(f) ? '(auth)' : null,
    groups: {
      '(family)': { roles: ['STUDENT'], mode: 'all' },
      '(staff)': { roles: ['TEACHER'], mode: 'all' },
      '(worker)': { roles: ['STAFF'], mode: 'all' },
    },
  };
}

/** The web portals, per apps/web/lib/role-routes.ts. */
export function webSurface(): Surface {
  const web = repoPath('apps/web');
  const app = path.join(web, 'app');
  const area = (f: string) => {
    for (const a of ['portal', 'teacher', 'staff', 'library', 'sports', 'alumni', 'app']) if (inDir(app, a)(f)) return a;
    return null;
  };
  return {
    name: 'web',
    root: web,
    aliasRoot: web,
    groupOf: area,
    groups: {
      portal: { roles: ['STUDENT'], mode: 'all' },
      teacher: { roles: ['TEACHER'], mode: 'all' },
      staff: { roles: ['STAFF'], mode: 'all' },
      alumni: { roles: ['ALUMNUS'], mode: 'all' },
      // Office console: admins plus the staff desks it hosts (ACCOUNTS, ADMISSIONS…).
      app: { roles: ['SCHOOL_ADMIN', 'STAFF'], mode: 'any' },
      library: { roles: ['STAFF', 'SCHOOL_ADMIN', 'TEACHER'], mode: 'any' },
      sports: { roles: ['STAFF', 'SCHOOL_ADMIN', 'TEACHER'], mode: 'any' },
    },
  };
}
