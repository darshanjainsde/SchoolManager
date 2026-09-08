#!/usr/bin/env node
/**
 * sckools-expert inventory generator.
 * Reads the repository at --root (default: the git toplevel of cwd) and writes
 * machine-derived reference tables into references/inventory/. No deps.
 *
 *   node .claude/skills/sckools-expert/scripts/inventory.mjs --root /path/to/tree
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'references', 'inventory');
const ROOT = argOf('--root') ?? execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
mkdirSync(OUT, { recursive: true });

const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));
function walk(dir, pred, acc = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, pred, acc);
    else if (pred(rel)) acc.push(rel);
  }
  return acc;
}
const md = (rows, header) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');

/* ── stamp ── */
const sha = sh('git rev-parse HEAD');
const short = sh('git rev-parse --short HEAD');
const branch = sh('git rev-parse --abbrev-ref HEAD');
const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
const when = new Date().toISOString();
const state = { sha, short, branch, upstream, generatedAt: when, root: ROOT };
writeFileSync(join(OUT, 'STATE.json'), JSON.stringify(state, null, 2) + '\n');
const stamp = `_Generated ${when.slice(0, 10)} from \`${short}\` (${branch}${upstream ? ` → ${upstream}` : ''}). Do not edit by hand — run the sckools-expert-update skill._\n\n`;

/* ── data model ── */
{
  const schema = read('packages/db/prisma/schema.prisma');
  const rls = new Set();
  for (const f of walk('packages/db/prisma/migrations', (p) => p.endsWith('.sql'))) {
    const sql = read(f);
    for (const m of sql.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ENABLE ROW LEVEL SECURITY/gi)) rls.add(m[1]);
    for (const m of sql.matchAll(/ARRAY\[([^\]]+)\]/g)) for (const t of m[1].matchAll(/'(\w+)'/g)) rls.add(t[1]);
  }
  const enums = [...schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)].map((m) => [m[1], m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join(', ')]);
  const enumNames = new Set(enums.map((e) => e[0]));
  const models = [];
  const re = /((?:^\/\/\/.*\n)*)^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const m of schema.matchAll(re)) {
    const doc = m[1].replace(/^\/\/\/\s?/gm, '').trim().replace(/\s+/g, ' ');
    const name = m[2];
    const body = m[3].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    const fields = body.filter((l) => !l.startsWith('@@'));
    const scalars = fields.filter((l) => !/@relation|\w+\[\]$|\w+\?$/.test(l) || !/^[a-zA-Z_]+\s+[A-Z]\w+(\[\]|\?)?\s*(@relation|$)/.test(l)).length;
    const relations = fields.map((l) => l.split(/\s+/)).filter((t) => t.length >= 2 && /^[A-Z]\w+(\[\]|\?)?$/.test(t[1]) && !/^(String|Int|Boolean|DateTime|Json|Float|Decimal|BigInt|Bytes)(\[\]|\?)?$/.test(t[1])).map((t) => t[1].replace(/[\[\]?]/g, '')).filter((t) => !enumNames.has(t));
    const uniques = body.filter((l) => l.startsWith('@@unique')).map((l) => l.replace('@@unique', '').replace(/[()]/g, '')).join(' ; ');
    const tenant = /^\s*schoolId\s/m.test(m[3]) ? 'yes' : 'no';
    models.push([name, tenant, rls.has(name) ? 'yes' : (tenant === 'yes' ? '**no**' : '—'), fields.length, [...new Set(relations)].join(', '), uniques, doc.slice(0, 140)]);
  }
  writeFileSync(join(OUT, 'data-model.md'), `# Data model (packages/db/prisma/schema.prisma)\n\n${stamp}${models.length} models, ${enums.length} enums. "RLS" is whether any migration enabled row-level security on the table; a tenant table with **no** is filtered by application code only.\n\n## Models\n\n${md(models, ['Model', 'Tenant (schoolId)', 'RLS', 'Fields', 'Relations', 'Unique', 'Doc'])}\n\n## Enums\n\n${md(enums, ['Enum', 'Values'])}\n`);
}

/* ── API routes ── */
{
  const rows = [];
  const files = walk('apps/api/src', (p) => p.endsWith('.controller.ts'));
  for (const f of files) {
    const src = read(f);
    const ctrl = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]?\s*\)/);
    const prefix = ctrl ? ctrl[1] : '';
    const classIdx = src.search(/export class \w+Controller/);
    const head = src.slice(0, classIdx);
    const classRoles = (head.match(/@Roles\(([^)]*)\)/) || [])[1]?.replace(/['"\s]/g, '') ?? '';
    const classFeature = (head.match(/@RequireFeature\(\s*['"]([A-Z_]+)['"]/) || [])[1] ?? '';
    const classGuards = (head.match(/@UseGuards\(([^)]*)\)/) || [])[1]?.replace(/\s/g, '') ?? '';
    const body = src.slice(classIdx);
    const re = /((?:\s*@(?:Roles|RequireFeature|Public|Throttle|UseGuards|UseInterceptors|Header)\([^)]*\)\s*)*)@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
    for (const m of body.matchAll(re)) {
      const decos = m[1] || '';
      const roles = (decos.match(/@Roles\(([^)]*)\)/) || [])[1]?.replace(/['"\s]/g, '') ?? classRoles;
      const feature = (decos.match(/@RequireFeature\(\s*['"]([A-Z_]+)['"]/) || [])[1] ?? classFeature;
      const pub = /@Public\(/.test(decos) ? 'public' : '';
      const path = '/' + [prefix, m[3] ?? ''].filter(Boolean).join('/').replace(/\/+/g, '/');
      rows.push([m[2].toUpperCase(), path, pub || roles || '', feature, classGuards, f]);
    }
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const byModule = {};
  for (const r of rows) { const mod = r[5].split('/')[3] ?? '?'; (byModule[mod] ??= []).push(r); }
  let out = `# API surface (apps/api/src/**/*.controller.ts)\n\n${stamp}${rows.length} routes across ${files.length} controllers. Roles column shows the handler's @Roles (which REPLACES the class list) or "public". Feature = @RequireFeature gate.\n`;
  for (const mod of Object.keys(byModule).sort()) out += `\n## ${mod}\n\n${md(byModule[mod], ['Method', 'Path', 'Roles', 'Feature', 'Guards (class)', 'File'])}\n`;
  writeFileSync(join(OUT, 'api-routes.md'), out);
}

/* ── web routes ── */
{
  const pages = walk('apps/web/app', (p) => /\/page\.tsx$/.test(p)).map((p) => {
    const route = '/' + p.replace(/^apps\/web\/app\/?/, '').replace(/\/page\.tsx$/, '').split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/');
    const src = read(p);
    const client = /^'use client'/m.test(src) ? 'client' : 'server';
    const meta = /generateMetadata|export const metadata/.test(src) ? 'yes' : '';
    return [route === '/' ? '/' : route.replace(/\/$/, ''), client, meta, p];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  const mw = exists('apps/web/middleware.ts') ? (read('apps/web/middleware.ts').match(/matcher:\s*\[([\s\S]*?)\]/) || [])[1]?.replace(/\s+/g, ' ').trim() ?? '' : '';
  const cfg = exists('apps/web/next.config.mjs') ? read('apps/web/next.config.mjs') : '';
  const rewrites = [...cfg.matchAll(/source:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  writeFileSync(join(OUT, 'web-routes.md'), `# Web routes (apps/web/app/**/page.tsx)\n\n${stamp}${pages.length} pages. Tenant vs platform host decides what a route serves — see architecture.md.\n\n${md(pages, ['Route', 'Render', 'Metadata', 'File'])}\n\n## Middleware matcher\n\n\`${mw || '(none)'}\`\n\n## next.config rewrites (sources)\n\n${rewrites.map((r) => `- \`${r}\``).join('\n') || '(none)'}\n`);
}

/* ── mobile routes ── */
{
  const files = walk('apps/mobile/src/app', (p) => p.endsWith('.tsx') && !/__tests__|\.test\./.test(p));
  const rows = files.map((p) => ['/' + p.replace(/^apps\/mobile\/src\/app\/?/, '').replace(/\.tsx$/, ''), p]).sort((a, b) => a[0].localeCompare(b[0]));
  writeFileSync(join(OUT, 'mobile-routes.md'), `# Mobile routes (apps/mobile/src/app, expo-router)\n\n${stamp}${rows.length} route files. \`(family)\` = the STUDENT login shared by student and guardian; \`(staff)\` = SCHOOL_ADMIN / TEACHER / STAFF.\n\n${md(rows, ['Route', 'File'])}\n`);
}

/* ── features & tiers ── */
{
  const src = read('packages/db/src/features.ts');
  const keysBlock = (src.split('export type FeatureKey =')[1] || '').split(';')[0];
  const keys = [...keysBlock.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  const arr = (name) => {
    const start = src.indexOf('const ' + name + ': FeatureKey[] = [');
    if (start < 0) return [];
    const open = src.indexOf('= [', start) + 3;
    const body = src.slice(open, src.indexOf(']', open));
    return [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  };
  const basic = arr('BASIC');
  const standard = [...basic, ...arr('STANDARD')];
  const pro = [...standard, ...arr('PRO')];
  const gates = {};
  for (const f of walk('apps/api/src', (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))) for (const m of read(f).matchAll(/@RequireFeature\(\s*['"]([A-Z_]+)['"]/g)) (gates[m[1]] ??= new Set()).add(f);
  const rows = keys.map((k) => [k, basic.includes(k) ? '✅' : '—', standard.includes(k) ? '✅' : '—', pro.includes(k) ? '✅' : '—', [...(gates[k] ?? [])].join('<br>')]);
  writeFileSync(join(OUT, 'features.md'), `# Feature keys and tiers (packages/db/src/features.ts)\n\n${stamp}Tier sets are cumulative (BASIC ⊂ STANDARD ⊂ PRO) and a \`FeatureOverride\` row can add or remove any key per school. Keys in no tier (e.g. ALUMNI, PRESS) are override-only. Resolved sets are cached in Redis for 300s (feature-resolver.service.ts).\n\n${md(rows, ['Key', 'BASIC', 'STANDARD', 'PRO', 'Gated controllers'])}\n`);
}

/* ── notifications ── */
{
  const p = 'apps/api/src/common/notifications/notification.types.ts';
  const src = exists(p) ? read(p) : '';
  const kinds = [...new Set([...src.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]))];
  writeFileSync(join(OUT, 'notifications.md'), `# Notification kinds (${p})\n\n${stamp}${kinds.map((k) => `- \`${k}\``).join('\n')}\n\nChannels: e-mail (SMTP), push (Expo), in-app (\`/me/notifications\`). Best-effort and post-commit — a delivery failure never fails the write that triggered it. WhatsApp/SMS are NOT built.\n`);
}

/* ── migrations ── */
{
  const dirs = existsSync(join(ROOT, 'packages/db/prisma/migrations')) ? readdirSync(join(ROOT, 'packages/db/prisma/migrations')).filter((d) => /^\d/.test(d)).sort() : [];
  const rows = dirs.map((d) => { const f = `packages/db/prisma/migrations/${d}/migration.sql`; const first = exists(f) ? (read(f).split('\n').find((l) => l.trim().startsWith('--')) || '').replace(/^--\s*/, '') : ''; return [d, first.slice(0, 120)]; });
  writeFileSync(join(OUT, 'migrations.md'), `# Migrations (packages/db/prisma/migrations)\n\n${stamp}${rows.length} migrations. Staging applies them on push to \`staging\` (db-migrate.yml, path-filtered); production is a manual \`workflow_dispatch\` with \`environment=production\`.\n\n${md(rows, ['Migration', 'First comment'])}\n`);
}

/* ── workflows ── */
{
  const files = existsSync(join(ROOT, '.github/workflows')) ? readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)) : [];
  const rows = files.map((f) => {
    const y = read(`.github/workflows/${f}`);
    const name = (y.match(/^name:\s*(.+)$/m) || [])[1] ?? f;
    const on = (y.match(/^on:\s*\n([\s\S]*?)(?=^\w)/m) || [])[1] ?? '';
    const triggers = [...on.matchAll(/^  (\w+):/gm)].map((m) => m[1]);
    const branches = [...on.matchAll(/branches:\s*\[([^\]]*)\]/g)].map((m) => m[1].replace(/\s/g, '')).join(';');
    const paths = [...on.matchAll(/paths:\s*\n((?:\s+-.*\n)+)/g)].map((m) => m[1].replace(/\s+-\s*/g, ' ').trim()).join(';');
    return [f, name, triggers.join(', '), branches, paths];
  });
  writeFileSync(join(OUT, 'workflows.md'), `# GitHub workflows (.github/workflows)\n\n${stamp}${md(rows, ['File', 'Name', 'Triggers', 'Branches', 'Paths'])}\n`);
}

/* ── packages ── */
{
  const rows = [];
  for (const d of ['apps', 'packages']) for (const name of readdirSync(join(ROOT, d))) {
    const pj = join(d, name, 'package.json');
    if (!exists(pj)) continue;
    const p = JSON.parse(read(pj));
    const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    const pick = ['next', 'react', '@nestjs/core', 'prisma', '@prisma/client', 'expo', 'react-native', 'vitest', 'jest', 'typescript'].filter((k) => deps[k]).map((k) => `${k}@${deps[k]}`).join(', ');
    rows.push([p.name, `${d}/${name}`, Object.keys(p.scripts || {}).join(', '), pick]);
  }
  writeFileSync(join(OUT, 'packages.md'), `# Workspace packages\n\n${stamp}${md(rows, ['Package', 'Path', 'Scripts', 'Key dependencies'])}\n`);
}

/* ── env ── */
{
  const cfg = exists('packages/config/src/index.ts') ? read('packages/config/src/index.ts') : '';
  const declared = [...new Set([...cfg.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]))];
  const used = new Set();
  for (const f of walk('apps', (p) => /\.(ts|tsx|mjs|js)$/.test(p) && !/\.(spec|test)\./.test(p))) for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  const rows = [...new Set([...declared, ...used])].sort().map((k) => [k, declared.includes(k) ? '✅' : '', used.has(k) ? '✅' : '']);
  writeFileSync(join(OUT, 'env.md'), `# Environment variables (names only — values live in GitHub Environments / Vercel env, never here)\n\n${stamp}${md(rows, ['Variable', 'Declared in packages/config', 'Read via process.env in apps'])}\n`);
}

/* ── docs index ── */
{
  const files = [...readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => f), ...walk('docs', (p) => p.endsWith('.md'))];
  const rows = files.map((f) => [f, (read(f).match(/^#\s+(.+)$/m) || [])[1]?.slice(0, 100) ?? '', read(f).split('\n').length]);
  writeFileSync(join(OUT, 'docs-index.md'), `# Documents in the repository\n\n${stamp}${md(rows, ['File', 'Title', 'Lines'])}\n`);
}

console.log(`inventory written to ${relative(process.cwd(), OUT)} from ${short} (${branch})`);
