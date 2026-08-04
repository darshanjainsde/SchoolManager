/**
 * Builds a browsable catalogue of every test in the repo.
 *
 * WHY A PARSER AND NOT A TEST RUN. The runners already tell us which tests
 * exist — but only by name, only after a full run, and only for the suites
 * that got as far as executing. This dashboard's whole reason for existing is
 * that a gate which never ran hides everything behind it, so the catalogue has
 * to be readable with nothing green and nothing installed. Reading the source
 * gives us the tests, their nesting, their file and line, AND the comment the
 * author wrote above them — which no runner reports and which is the only
 * place the *intent* of a test is written down.
 *
 * It is a lexical scan, not a TypeScript parse: this tool is zero-dependency
 * on purpose (see server.mjs), and a real parser would mean a build step for a
 * thing whose job is to keep working when the build is broken. The trade-off
 * is that it understands the shapes this repo actually writes, and marks
 * anything it cannot read rather than guessing.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/* ── Where a test lives → what a human calls that part of the product ───────
 *
 * Ordered: the FIRST match wins, so specific paths precede the catch-alls for
 * their workspace. The point of this table is that "apps/mobile/src/app/
 * (staff)/take/[classSectionId].tsx" is not a useful heading for anyone
 * deciding whether the register is tested — "Teacher app · Attendance" is.
 */
const AREAS = [
  // ── Web ────────────────────────────────────────────────────────────────
  { match: /^apps\/web\/app\/teacher\//, portal: 'Teacher portal', platform: 'web' },
  { match: /^apps\/web\/app\/portal\//, portal: 'Student & family portal', platform: 'web' },
  { match: /^apps\/web\/app\/app\//, portal: 'Admin console', platform: 'web' },
  { match: /^apps\/web\/app\/(owner|platform)\//, portal: 'Owner console', platform: 'web' },
  { match: /^apps\/web\/app\/(login|forgot-password|reset|accept-invite|sign)/, portal: 'Sign-in & access', platform: 'web' },
  { match: /^apps\/web\/app\/blog\//, portal: 'Marketing site', platform: 'web', feature: 'Blog' },
  { match: /^apps\/web\/components\/teacher\//, portal: 'Teacher portal', platform: 'web' },
  { match: /^apps\/web\/components\/marketing\//, portal: 'Marketing site', platform: 'web' },
  { match: /^apps\/web\/components\//, portal: 'Shared web components', platform: 'web' },
  { match: /^apps\/web\/lib\//, portal: 'Web plumbing', platform: 'web' },
  { match: /^apps\/web\/app\//, portal: 'Marketing site', platform: 'web' },
  { match: /^apps\/web\//, portal: 'Web plumbing', platform: 'web' },

  // ── Mobile ─────────────────────────────────────────────────────────────
  { match: /^apps\/mobile\/src\/app\/\(staff\)\//, portal: 'Teacher app', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/app\/\(family\)\//, portal: 'Family app', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/app\/\(worker\)\//, portal: 'Support-staff app', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/app\/\(auth\)\//, portal: 'Sign-in & access', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/components\//, portal: 'Shared app components', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/theme\//, portal: 'Design system', platform: 'mobile' },
  { match: /^apps\/mobile\/src\/lib\//, portal: 'App plumbing', platform: 'mobile' },
  { match: /^apps\/mobile\//, portal: 'App plumbing', platform: 'mobile' },

  // ── API & data ─────────────────────────────────────────────────────────
  // Deliberately NOT grouped by NestJS module: `management` alone held 416
  // tests, which is a heading that tells you nothing. The file name is the
  // real subject — attendance.service.spec.ts is the attendance tests.
  { match: /^apps\/api\/src\/modules\/([^/]+)\//, portal: 'API', platform: 'api', group: 1 },
  { match: /^apps\/api\//, portal: 'API', platform: 'api' },
  { match: /^packages\/db\//, portal: 'Database', platform: 'db' },
  { match: /^packages\/([^/]+)\//, portal: 'Shared packages', platform: 'db', fromMatch: 1 },
];

/** Path segments that name a plumbing concern rather than a product feature. */
const NOT_A_FEATURE = new Set([
  '__tests__', 'src', 'app', 'lib', 'components', 'internal', 'modules', 'apps', 'packages', 'theme',
]);

const TITLE_OVERRIDES = {
  cms: 'Site content (CMS)',
  db: 'Database',
  api: 'API',
  sk: 'Design system',
  seo: 'SEO',
  fx: 'Currency',
};

function titleCase(s) {
  if (TITLE_OVERRIDES[s]) return TITLE_OVERRIDES[s];
  return s
    .replace(/[-_.]+/g, ' ')
    .replace(/\[|\]/g, '')
    .replace(/\(|\)/g, '')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The feature is the most specific meaningful directory between the portal
 * root and the file — falling back to the file's own name when the test sits
 * directly in a folder we've already used as the heading.
 */
export function classify(relPath) {
  const area = AREAS.find((a) => a.match.test(relPath));
  const parts = relPath.split('/');
  const base = parts[parts.length - 1]
    .replace(/\.(test|spec)\.(tsx?|mts|mjs)$/, '')
    // `.service` / `.controller` / `.guard` name the layer, not the subject.
    .replace(/\.(service|controller|guard|module|middleware|resolver|dto|util|helper)$/, '');

  if (!area) return { portal: 'Other', platform: 'other', feature: titleCase(base), group: null };
  const group = area.group ? titleCase(relPath.match(area.match)[area.group]) : null;
  if (area.feature) return { portal: area.portal, platform: area.platform, feature: area.feature, group };
  if (area.group) return { portal: area.portal, platform: area.platform, feature: titleCase(base), group };

  // Walk backwards from the file for the first segment that names something a
  // person would recognise; the file's own name is the last resort and is
  // usually right (page.test.tsx in .../attendance/ → the directory wins).
  const prefixLen = (relPath.match(area.match)?.[0] ?? '').split('/').filter(Boolean).length;
  const tail = parts.slice(prefixLen, -1).filter((p) => !NOT_A_FEATURE.has(p));
  const feature = tail.length ? titleCase(tail[0]) : titleCase(base);
  return { portal: area.portal, platform: area.platform, feature, group: null };
}

/* ── Lexical scan ──────────────────────────────────────────────────────── */

const IS_TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|mjs)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.expo', 'coverage', '.git', '.cache']);

async function walk(dir, repo, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, repo, out);
    else if (IS_TEST_FILE.test(e.name)) out.push(relative(repo, p).split(sep).join('/'));
  }
  return out;
}

/**
 * Reads a JS string literal beginning at `i` (which must be its opening quote)
 * and returns [value, indexAfterClosingQuote]. Handles escapes, and treats a
 * template literal as a plain string as long as it has no `${}` — a
 * parametrised name is reported as unreadable rather than guessed at.
 */
function readString(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let out = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      out += src[j + 1] === 'n' ? ' ' : src[j + 1];
      j += 2;
      continue;
    }
    if (c === quote) return [out, j + 1];
    if (quote === '`' && c === '$' && src[j + 1] === '{') return null; // interpolated
    out += c;
    j++;
  }
  return null;
}

/**
 * The comment block immediately above a line, as prose.
 *
 * This is the payload that makes the catalogue worth reading: in this repo the
 * comment above a test says WHY it exists and what broke without it, which is
 * exactly the thing a test name has no room for.
 */
function commentAbove(lines, lineIdx) {
  const collected = [];
  let i = lineIdx - 1;

  // A JSDoc block: scan up to its opening.
  if (/^\s*\*\//.test(lines[i] ?? '')) {
    const block = [];
    i--;
    while (i >= 0 && !/^\s*\/\*\*?/.test(lines[i])) {
      block.unshift((lines[i] ?? '').replace(/^\s*\*ted?\s?/, '').replace(/^\s*\*\s?/, ''));
      i--;
    }
    if (i >= 0) {
      const first = lines[i].replace(/^\s*\/\*\*?\s?/, '');
      if (first.trim()) block.unshift(first);
    }
    collected.push(...block);
  } else {
    // Contiguous `//` lines.
    while (i >= 0 && /^\s*\/\//.test(lines[i])) {
      collected.unshift(lines[i].replace(/^\s*\/\/\s?/, ''));
      i--;
    }
  }

  const text = collected.join('\n').trim();
  if (!text) return null;
  // Directives are instructions to a tool, not an explanation for a person.
  if (/^(eslint|@ts-|prettier|istanbul|c8 )/.test(text)) return null;
  return text;
}

/**
 * Comment blocks written INSIDE a test body, each with the code line it sits
 * above.
 *
 * These matter more here than the comment above the test. The repo's habit is
 * to name the test after the behaviour and then explain the reasoning at the
 * assertion it belongs to — "asserted on the dialog and the PUT, NOT on the
 * save toast, because ...". Dropping those would leave the catalogue showing
 * what is checked while discarding why it is checked that way.
 */
function notesIn(body, startLine) {
  const lines = body.split('\n');
  const notes = [];
  let buf = [];
  let bufStart = 0;

  const flush = (nextCodeLine) => {
    const text = buf.join('\n').trim();
    buf = [];
    if (!text) return;
    if (/^(eslint|@ts-|prettier|istanbul|c8 )/.test(text)) return;
    notes.push({ line: startLine + bufStart, text, about: (nextCodeLine ?? '').trim().slice(0, 120) || null });
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\/\//.test(l)) {
      if (!buf.length) bufStart = i;
      buf.push(l.replace(/^\s*\/\/\s?/, ''));
      continue;
    }
    if (buf.length) flush(l);
  }
  flush(null);
  return notes;
}

/**
 * The comment block a body OPENS with, skipping blank lines only.
 *
 * Stops at the first line of code, so a comment that belongs to the second
 * statement is never mistaken for a statement of intent about the whole block.
 */
function leadingComment(body) {
  const out = [];
  for (const l of body.split('\n')) {
    if (!l.trim()) {
      if (out.length) break; // a blank line ends the block
      continue;
    }
    if (/^\s*\/\//.test(l)) {
      out.push(l.replace(/^\s*\/\/\s?/, ''));
      continue;
    }
    break;
  }
  const text = out.join('\n').trim();
  if (!text || /^(eslint|@ts-|prettier|istanbul|c8 )/.test(text)) return null;
  return text;
}

/** Matcher names used in a slice of source, in order, de-duplicated. */
function assertionsIn(body) {
  const found = [];
  const re = /\.(toBe|toEqual|toStrictEqual|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeUndefined|toContain|toContainEqual|toMatch|toMatchObject|toHaveLength|toHaveBeenCalled|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveTextContent|toHaveAttribute|toBeInTheDocument|toBeVisible|toBeDisabled|toThrow|toThrowError|toRejects|toBeGreaterThan|toBeLessThan|toBeCloseTo|rejects|resolves)\b/g;
  let m;
  while ((m = re.exec(body))) if (!found.includes(m[1])) found.push(m[1]);
  return found;
}

/**
 * Extracts describes and tests from one file.
 *
 * Brace counting is done on a copy with strings, template literals and
 * comments blanked out, so a `{` inside a string or a JSX prop cannot close a
 * block early. That blanking is the only reason a lexical scan is safe enough
 * to trust here.
 */
export function parseTestFile(src, relPath) {
  const blanked = blankLiterals(src);
  const lines = src.split('\n');
  const lineStart = [];
  {
    let pos = 0;
    for (const l of lines) {
      lineStart.push(pos);
      pos += l.length + 1;
    }
  }
  const lineOf = (idx) => {
    let lo = 0;
    let hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const tests = [];
  const stack = []; // open describes: { title, end }
  const re = /\b(describe|it|test)\s*(\.\s*(?:each|only|skip|todo|concurrent|failing)\s*)?\(/g;
  let m;

  while ((m = re.exec(blanked))) {
    const kind = m[1];
    const modifier = (m[2] ?? '').replace(/[.\s]/g, '') || null;
    const openParen = m.index + m[0].length - 1;

    // `describe.each([...])('name')` and `it.each` take a table first; the
    // name is in a SECOND call. Reported as parametrised rather than guessed.
    let nameStart = openParen + 1;
    while (/\s/.test(blanked[nameStart] ?? '')) nameStart++;

    const readFrom = readString(src, nameStart);
    const title = readFrom ? readFrom[0] : null;

    // Where does this block end? Find the arrow function body's braces.
    const bodyOpen = blanked.indexOf('{', readFrom ? readFrom[1] : openParen);
    const bodyClose = bodyOpen === -1 ? -1 : matchBrace(blanked, bodyOpen);

    // Close any describes we have walked past.
    while (stack.length && stack[stack.length - 1].end < m.index) stack.pop();

    const line = lineOf(m.index);

    if (kind === 'describe') {
      // A describe's comment explains the whole group, so every test inside it
      // inherits that context — usually the clearest statement of intent in
      // the file, and invisible if we only looked directly above each `it`.
      // Either side of the opening brace counts. This repo's habit is to put
      // the group's reasoning as the FIRST thing inside the describe rather
      // than above it, so looking only upwards found almost none of them.
      const groupBody = bodyClose > bodyOpen ? src.slice(bodyOpen + 1, bodyClose) : '';
      stack.push({
        title: title ?? '(dynamic group)',
        why: commentAbove(lines, line) ?? leadingComment(groupBody),
        end: bodyClose === -1 ? Infinity : bodyClose,
      });
      continue;
    }

    const body = bodyClose > bodyOpen ? src.slice(bodyOpen, bodyClose) : '';
    const why = commentAbove(lines, line) ?? leadingComment(body.slice(1));
    // When the "why" WAS the body's opening comment, it is also notes[0] —
    // and rendering both put the identical paragraph on screen twice under
    // two different headings, which reads as two separate facts.
    const notes = notesIn(body, lineOf(bodyOpen) + 1).filter((n) => n.text !== why);
    tests.push({
      name: title,
      parametrised: !title && modifier === 'each',
      unreadable: !title && modifier !== 'each',
      modifier: modifier && modifier !== 'each' ? modifier : null,
      groups: stack.map((s) => ({ title: s.title, why: s.why })),
      line: line + 1,
      why,
      notes,
      assertions: assertionsIn(body),
      lineCount: body ? body.split('\n').length : 0,
    });
  }

  return tests;
}

/** Replaces string/template/comment contents with spaces, preserving offsets. */
function blankLiterals(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++; // keep the opening quote so readString can find it
      while (i < n) {
        if (src[i] === '\\') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join('');
}

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ── Public entry point ────────────────────────────────────────────────── */

/** Which runner owns a file — decides how a single test is invoked. */
export function runnerFor(relPath) {
  if (relPath.startsWith('apps/web/')) return 'vitest';
  return 'jest';
}

export function workspaceFor(relPath) {
  if (relPath.startsWith('apps/web/')) return 'apps/web';
  if (relPath.startsWith('apps/api/')) return 'apps/api';
  if (relPath.startsWith('apps/mobile/')) return 'apps/mobile';
  const m = relPath.match(/^(packages\/[^/]+)\//);
  return m ? m[1] : '.';
}

/**
 * Scans the repo and returns the full catalogue plus a mtime fingerprint, so
 * the server can serve a cached copy until a test file actually changes.
 */
export async function buildCatalogue(repo, roots = ['apps', 'packages', 'tools']) {
  const files = [];
  for (const r of roots) await walk(join(repo, r), repo, files);
  files.sort();

  let newestMtime = 0;
  const out = [];
  let totalTests = 0;
  let described = 0;

  for (const rel of files) {
    let src;
    let mtime = 0;
    try {
      src = await readFile(join(repo, rel), 'utf8');
      mtime = (await stat(join(repo, rel))).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > newestMtime) newestMtime = mtime;

    let tests = [];
    let parseError = null;
    try {
      tests = parseTestFile(src, rel);
    } catch (e) {
      parseError = e.message;
    }

    const { portal, platform, feature, group } = classify(rel);
    // The header comment of a test FILE usually says what the whole file is
    // for; it is the natural summary for the file node in the tree.
    const fileWhy = fileHeaderComment(src);

    totalTests += tests.length;
    // "Explained" means a reader can find out WHY this test exists without
    // opening the file — from its own comment, its group's, or a note at one
    // of its assertions. Counted honestly so the gap is visible in the UI.
    described += tests.filter(
      (t) => t.why || t.notes?.length || t.groups.some((g) => g.why),
    ).length;

    out.push({
      path: rel,
      portal,
      platform,
      feature,
      group,
      runner: runnerFor(rel),
      workspace: workspaceFor(rel),
      why: fileWhy,
      parseError,
      tests,
    });
  }

  return {
    files: out,
    fingerprint: `${files.length}:${Math.round(newestMtime)}`,
    stats: {
      fileCount: out.length,
      testCount: totalTests,
      describedCount: described,
      portals: [...new Set(out.map((f) => f.portal))].sort(),
    },
    builtAt: Date.now(),
  };
}

/** The leading /** *\/ or // block of a file, if it reads like prose. */
function fileHeaderComment(src) {
  const trimmed = src.replace(/^﻿/, '');
  const jsdoc = trimmed.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (jsdoc) {
    const text = jsdoc[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim();
    if (text) return text;
  }
  const slashes = trimmed.match(/^((?:\s*\/\/[^\n]*\n)+)/);
  if (slashes) {
    const text = slashes[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/\s?/, ''))
      .join('\n')
      .trim();
    if (text && !/^(eslint|@ts-|prettier)/.test(text)) return text;
  }
  return null;
}
