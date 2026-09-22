/**
 * The checks. One export per rule, each one a thing that actually bit us.
 *
 * Every rule here exists because a real screen shipped with it. The comment on
 * each says which, so nobody has to guess whether a rule is real or someone's
 * taste. A rule with no incident behind it does not belong in this file.
 *
 * A check returns `null` when the page is clean, or a finding:
 *   { rule, severity, detail, line? }
 *
 * Severity decides the page's grade, and the grades mean something specific:
 *   BROKEN   — a person can hit this and be stuck or misled. Fix now.
 *   MODERATE — works, but carries a known cost that grows with the data.
 *   PERFECT  — nothing on the list. Not "untested" — checked and clean.
 */

/**
 * Collections that can actually reach thousands of rows.
 *
 * Deliberately narrow, and it got narrower after the first run: matching the
 * WORD anywhere on the line flagged `d.invoices.filter(...)` for one student,
 * and `classes.filter(...)` over thirty, because the line happened to contain
 * "invoice" and "students". A rule that cries wolf makes the whole audit
 * ignorable, which is worse than not having it.
 *
 * So the RECEIVER must be a bare identifier — `students.filter(...)`, not
 * `somebody.invoices.filter(...)` — and it must name a roll of people, not a
 * list belonging to one person.
 */
const ROSTER_RECEIVER = /^(all)?(students|roster|alumni|attendance|marks|results|rows|children|pupils)$/i;

// ── BROKEN ───────────────────────────────────────────────────────────────────

/**
 * A failed request rendered as a loading message.
 *
 * `if (q.isLoading || !q.data)` is true on every failure — data undefined,
 * isLoading false — so a 500, a dropped connection or an expired session sits
 * on the loading line for good. Found on 13 screens in September 2026; the one
 * that got reported was the year-end wizard's "Adding it up…", behind queries
 * that take 0.5–3.7 ms. The product was not slow, it had failed.
 */
export function swallowedError({ src, lines }) {
  const out = [];
  lines.forEach((line, i) => {
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//')) return;
    const m = line.match(/if\s*\(\s*(\w+)\.(?:isLoading|isPending)\s*\|\|\s*!/);
    if (!m) return;
    if (new RegExp(`\\b${m[1]}\\.isError\\b`).test(src)) return;
    out.push({
      rule: 'swallowed-error',
      severity: 'BROKEN',
      line: i + 1,
      detail: `\`${m[1]}\` gates on loading but its failure is never rendered — a failed request shows the loading message for ever`,
    });
  });
  return out;
}

/**
 * A server component calling a function that lives in a 'use client' module.
 *
 * Every export of a client module is a client reference in the RSC graph, not
 * just the component, so the call throws at REQUEST time. This took every
 * school site down on staging in September 2026, and tsc, eslint, a
 * renderToStaticMarkup harness and `next build` were all green while it was
 * broken.
 */
export function clientBoundary({ src, lines, isClient, resolve, isClientFile }) {
  if (isClient) return [];
  const out = [];
  for (const m of src.matchAll(/^import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"];?$/gm)) {
    if (/^import\s+type\b/.test(m[0])) continue;
    const target = resolve(m[2]);
    if (!target || !isClientFile(target)) continue;
    const braces = m[1].match(/\{([^}]*)\}/);
    if (!braces) continue;
    for (const raw of braces[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (!name || /^[A-Z]/.test(name)) continue; // a Component may cross
      out.push({
        rule: 'client-boundary',
        severity: 'BROKEN',
        line: lines.findIndex((l) => l.includes(m[2])) + 1,
        detail: `imports \`${name}\` from the client module ${m[2]} — calling it from the server throws at request time`,
      });
    }
  }
  return out;
}

// ── MODERATE ─────────────────────────────────────────────────────────────────

/**
 * A query whose failure is never shown anywhere on the page.
 *
 * Weaker than swallowed-error: the screen does not lie about loading, it just
 * renders nothing and says nothing. Fine for a notification badge, wrong for
 * anything a person is waiting on.
 */
export function silentQuery({ src }) {
  const n = (src.match(/useQuery[<(]/g) || []).length;
  if (!n) return [];
  if (/isError|\.error\b/.test(src)) return [];
  return [{
    rule: 'silent-query',
    severity: 'MODERATE',
    detail: `${n} quer${n > 1 ? 'ies' : 'y'}, and no error is rendered anywhere on the page`,
  }];
}

/**
 * A screen that opens with a lot of separate requests.
 *
 * Each one is a round trip and, on the API, its own tenant transaction holding
 * a pooled connection. The family portal opened with seven until September
 * 2026; composing them into one took it to a single transaction.
 */
export function requestFanOut({ mountQueries }) {
  if (mountQueries < 6) return [];
  return [{
    rule: 'request-fan-out',
    severity: 'MODERATE',
    detail: `${mountQueries} queries fire when this page mounts — each is a round trip and a tenant transaction`,
  }];
}

/**
 * Array work over roster-scale data, recomputed on every render.
 *
 * The students page walked the roll four times per render — the search filter,
 * two counts, the selection — and rebuilt `trim().toLowerCase()` inside the
 * callback for every child. Every keystroke, on a list whose ceiling is 20,000.
 */
export function unmemoisedRosterWork({ lines }) {
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/(?:^|[^.\w])(\w+)\.(?:filter|sort|reduce|flatMap)\(/);
    if (!m || !ROSTER_RECEIVER.test(m[1])) return;
    const before = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
    if (/useMemo\(|useCallback\(/.test(before)) return;
    out.push({
      rule: 'unmemoised-roster-work',
      severity: 'MODERATE',
      line: i + 1,
      detail: `walks \`${m[1]}\` in the render body`,
    });
  });
  // One finding per page; the line numbers are in the detail.
  return out.length ? [{ ...out[0], detail: `${out.length} place${out.length > 1 ? 's' : ''} walk a roster-scale list in the render body (first at line ${out[0].line}) — recomputed on every render` }] : [];
}

/**
 * A school photo painted at its original size.
 *
 * `optimised()` returns the URL untouched for an unregistered host, so wrapping
 * is always safe and there is no case where the bare interpolation is right.
 * Seven call sites shipped without it; a crest shown at 240px was a 238 KB JPEG.
 */
export function rawImage({ lines }) {
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/backgroundImage:\s*`url\('\$\{([^}]*)\}'\)`/);
    if (m && !m[1].trim().startsWith('optimised(')) {
      out.push({ rule: 'raw-image', severity: 'MODERATE', line: i + 1, detail: 'a school photo painted at whatever size it was uploaded' });
    }
    // An <img> whose src is a school-uploaded URL and never sees the optimiser.
    // A missing `loading` attribute is NOT flagged: an above-the-fold image
    // should not be lazy, so that is a judgement, not a fault.
    const img = line.match(/<img[^>]*\ssrc=\{([^}]+)\}/);
    if (img && !/optimised\(/.test(img[1]) && /url|photo|logo|image|cover|crest/i.test(img[1])) {
      out.push({ rule: 'raw-image', severity: 'MODERATE', line: i + 1, detail: `\`${img[1].trim().slice(0, 40)}\` is painted at whatever size it was uploaded` });
    }
  });
  return out.slice(0, 1);
}

/**
 * A page that ships a lot of JavaScript.
 *
 * The threshold is the shared baseline plus a working allowance, not a round
 * number: anything well above it is usually a tab bar importing every tab.
 */
export function heavyBundle({ firstLoadKb }) {
  if (!firstLoadKb || firstLoadKb < 160) return [];
  return [{
    rule: 'heavy-bundle',
    severity: 'MODERATE',
    detail: `${firstLoadKb} kB of first-load JavaScript — check for statically imported tabs or a section tree that could be split`,
  }];
}

export const CHECKS = [
  swallowedError,
  clientBoundary,
  silentQuery,
  requestFanOut,
  unmemoisedRosterWork,
  rawImage,
  heavyBundle,
];

/** BROKEN beats MODERATE beats PERFECT. */
export function gradeOf(findings) {
  if (findings.some((f) => f.severity === 'BROKEN')) return 'BROKEN';
  if (findings.length) return 'MODERATE';
  return 'PERFECT';
}
