import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Nest resolves a module's dependencies at BOOT, not at build: a controller
 * that guards with `RequireFeatureGuard` inside a module that never imports
 * `FeaturesModule` typechecks, bundles, passes every unit test — and then
 * aborts the whole application on the first request, so every route 500s.
 * That happened on the staging deploy of the WhatsApp channel (2026-09-20,
 * ~40 minutes of a dead API). Nothing in the local gate boots Nest, and a
 * push straight to staging skips the e2e job that does.
 *
 * This guard is the cheap, deterministic version of "does it boot": for every
 * module file, follow its controllers and providers to their source and
 * demand the import each well-known provider needs. It cannot see every DI
 * edge — only the ones that have already bitten — so add a row to NEEDS when
 * a new one does.
 */
const SRC = resolve(__dirname, '..');

/**
 * A symbol a file may use → the module that must be imported to satisfy it.
 * A provider module that is `@Global()` needs no import anywhere (Nest wires
 * it into every module), so each rule reads that from the module's own
 * source rather than assuming — TenancyModule IS global; FeaturesModule is not.
 */
const NEEDS: { uses: RegExp; module: string; file: string }[] = [
  { uses: /\bRequireFeatureGuard\b|\bRequireFeature\(/, module: 'FeaturesModule', file: 'modules/features/internal/features.module.ts' },
  { uses: /\bTenantContextService\b/, module: 'TenancyModule', file: 'modules/tenancy/internal/tenancy.module.ts' },
].filter((n) => !/@Global\(\)/.test(readFileSync(join(SRC, n.file), 'utf8')));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.module.ts')) out.push(p);
  }
  return out;
}

/** The `imports: [...]` list of a module file, as bare identifiers. */
function importsOf(src: string): string[] {
  const m = /imports:\s*\[([\s\S]*?)\]/.exec(src);
  return m ? m[1].split(',').map((s) => s.trim().split(/[\s.(]/)[0]).filter(Boolean) : [];
}

/** Every `X` in `controllers: [...]` and `provide: X` / `providers: [X, ...]`, resolved to a file via the module's own import lines. */
function memberFiles(moduleFile: string, src: string): string[] {
  const names = new Set<string>();
  for (const key of ['controllers', 'providers']) {
    const m = new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\](?=,?\\s*(?:controllers|providers|exports|imports)?:|,?\\s*\\})`).exec(src);
    if (!m) continue;
    for (const tok of m[1].split(',')) {
      const id = tok.trim().split(/[\s{(:]/)[0];
      if (/^[A-Z][A-Za-z0-9]*$/.test(id)) names.add(id);
    }
  }
  const files: string[] = [];
  for (const line of src.split('\n')) {
    const im = /import\s+\{([^}]+)\}\s+from\s+'([^']+)'/.exec(line);
    if (!im || !im[2].startsWith('.')) continue;
    const ids = im[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
    if (!ids.some((id) => names.has(id))) continue;
    const base = resolve(dirname(moduleFile), im[2]);
    for (const cand of [`${base}.ts`, join(base, 'index.ts')]) {
      try {
        statSync(cand);
        files.push(cand);
        break;
      } catch {
        /* try the next */
      }
    }
  }
  return files;
}

describe('every Nest module imports what its controllers and providers resolve at boot', () => {
  const modules = walk(join(SRC, 'modules')).concat(walk(join(SRC, 'common')));

  it('finds the modules, and knows TenancyModule is global while FeaturesModule is not', () => {
    expect(modules.length).toBeGreaterThan(10);
    expect(NEEDS.map((n) => n.module)).toEqual(['FeaturesModule']);
  });

  it.each(modules.map((f) => [f.replace(`${SRC}/`, ''), f]))('%s', (_rel, file) => {
    const src = readFileSync(file, 'utf8');
    if (/@Global\(\)/.test(src)) return; // a global module is its own provider
    const imports = importsOf(src);
    const members = memberFiles(file, src);
    const missing: string[] = [];
    for (const need of NEEDS) {
      if (file.endsWith(need.file)) continue; // the module that provides it
      const users = members.filter((m) => need.uses.test(readFileSync(m, 'utf8')));
      if (users.length && !imports.includes(need.module)) {
        missing.push(`${need.module} — needed by ${users.map((u) => u.replace(`${SRC}/`, '')).join(', ')}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
