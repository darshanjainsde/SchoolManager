import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * A FORM UPLOAD MUST GO OUT AS MULTIPART, NOT AS `{}`.
 *
 * `JSON.stringify(new FormData())` does not throw and does not produce
 * "[object FormData]". FormData keeps its entries in internal slots with no
 * enumerable own properties, so it serialises to the two characters `{}`.
 * `ApiClient.post` stringifies whatever it is handed, so a FormData passed to
 * it leaves the browser as:
 *
 *     Content-Type: application/json
 *     Content-Length: 2
 *     {}
 *
 * Every field silently gone. The server then answers with a validation error
 * naming whichever property its DTO happened to check first — on staging that
 * was "studentId must be a UUID", which reads like a bad id and sends the
 * diagnosis to the picker rather than to the encoding. Three fee screens
 * shipped this way: the counter payment, the parent's "I have paid", and the
 * UPI QR upload. Confirmed from the API's own request log, not inferred.
 *
 * `ApiClient.post/patch/put` now reject FormData at COMPILE time (the
 * `B extends FormData ? never : B` parameter), which is the real guard. This
 * one exists because the type can be cast past, and because a filesystem sweep
 * says something the type cannot: that no NEW screen has reintroduced the
 * shape somewhere nobody was looking.
 */

const ROOTS = ['app', 'components', 'lib'].map((r) => resolve(process.cwd(), r));

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap(sourcesUnder).map(
  (f) => [relative(process.cwd(), f), readFileSync(f, 'utf8')] as const,
);

describe('multipart uploads reach the server as multipart', () => {
  it('reads the app at all — an empty sweep would pass forever', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.filter(([, src]) => src.includes('new FormData()')).length).toBeGreaterThan(5);
  });

  it('never hands a FormData to post/patch/put — those JSON-encode it to `{}`', () => {
    const offenders: string[] = [];
    for (const [name, src] of FILES) {
      // Every `const form = new FormData()` style declaration in the file…
      const vars = [...src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*new FormData\(\)/g)]
        .map((m) => m[1]);
      for (const v of new Set(vars)) {
        // …and any JSON method it is then passed to.
        const re = new RegExp(`\\.(post|patch|put)\\s*(?:<[^>]*>)?\\s*\\([^)]*\\b${v}\\b`, 'g');
        for (const m of src.matchAll(re)) {
          offenders.push(`${name}: .${m[1]}(… ${v} …) — use postForm`);
        }
      }
    }
    expect(
      offenders,
      `these send an empty {} instead of the form:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the three fee uploads specifically use postForm', () => {
    const expected = [
      ['app/portal/fees/page.tsx', '/me/fees/submit'],
      ['app/app/fees/payment-setup/page.tsx', '/manage/fees/payment-setup/bank/qr'],
      ['components/fees/record-payment-dialog.tsx', '/manage/fees/payments/record'],
    ] as const;
    for (const [file, path] of expected) {
      const entry = FILES.find(([n]) => n === file);
      expect(entry, `${file} not found — did it move?`).toBeDefined();
      expect(entry![1]).toContain(`postForm('${path}'`);
    }
  });
});

describe('why this matters', () => {
  it('JSON.stringify of a FormData really is the two characters {}', () => {
    const form = new FormData();
    form.append('studentId', '7f1c2b8e-0000-4000-8000-000000000000');
    form.append('amountMinor', '1840000');
    // Not a throw, not "[object FormData]" — a valid, empty, two-byte body.
    // This is the entire reason the bug was invisible to every other gate.
    expect(JSON.stringify(form)).toBe('{}');
    expect(JSON.stringify(form).length).toBe(2);
    // Meanwhile the data is there, and survives being sent as the body itself.
    expect(form.get('studentId')).toBe('7f1c2b8e-0000-4000-8000-000000000000');
  });
});
