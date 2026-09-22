#!/usr/bin/env node
/**
 * Submit our message templates to a WhatsApp Business Account.
 *
 *   WHATSAPP_WABA_ID=… node scripts/whatsapp-templates.mjs --dry
 *   WHATSAPP_WABA_ID=… node scripts/whatsapp-templates.mjs
 *
 * The bodies, sample values and buttons come from the API's own
 * `templates.ts` (SUBMISSIONS + EXTRA_SUBMISSIONS), not from the docs, so a
 * template can never be approved in a shape the code does not send. Templates
 * belong to the BUSINESS ACCOUNT, not to a number — moving to a new account
 * means submitting them again, which is why this exists as a script.
 *
 * Already-approved names are skipped rather than resubmitted. Reads the token
 * from ~/.sckools-whatsapp-token and never prints it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const G = `https://graph.facebook.com/${V}`;
const token = (process.env.WHATSAPP_TOKEN || (() => {
  try { return readFileSync(join(homedir(), '.sckools-whatsapp-token'), 'utf8').trim(); } catch { return ''; }
})()).trim();
const waba = process.env.WHATSAPP_WABA_ID;
const dry = process.argv.includes('--dry');

if (!token.startsWith('EAA')) { console.error('No usable token in ~/.sckools-whatsapp-token.'); process.exit(2); }
if (!waba) { console.error('Need WHATSAPP_WABA_ID in the environment.'); process.exit(2); }

// The source of truth. Parsed out of templates.ts rather than duplicated here:
// two copies of a template body is exactly how a template drifts from the code
// that sends it and starts failing with "parameter count mismatch".
const SRC = readFileSync(join(here, '..', 'apps/api/src/common/notifications/whatsapp/templates.ts'), 'utf8');
const PREFIX = 'sckools_';
const snake = (k) => k.toLowerCase();

function parseBlock(startMarker) {
  const from = SRC.indexOf(startMarker);
  if (from < 0) throw new Error(`could not find ${startMarker} in templates.ts`);
  const slice = SRC.slice(from);
  const end = slice.indexOf('\n};');
  return slice.slice(0, end);
}

function entries(block, keyRe) {
  const out = [];
  const re = new RegExp(`${keyRe}:\\s*\\{([\\s\\S]*?)\\n  \\}`, 'g');
  let m;
  while ((m = re.exec(block))) {
    const key = m[0].slice(0, m[0].indexOf(':')).trim().replace(/^\[|\]$/g, '');
    const body = /body:\s*'((?:[^'\\]|\\.)*)'/.exec(m[1]);
    const cat = /category:\s*'([A-Z]+)'/.exec(m[1]);
    const samples = /samples:\s*\[([\s\S]*?)\]/.exec(m[1]);
    const buttons = /buttons:\s*\[([\s\S]*?)\]/.exec(m[1]);
    const strs = (s) => [...(s ?? '').matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
    out.push({
      key,
      body: body ? body[1].replace(/\\'/g, "'") : '',
      category: cat ? cat[1] : 'UTILITY',
      samples: strs(samples?.[1]),
      buttons: strs(buttons?.[1]),
    });
  }
  return out;
}

const main = entries(parseBlock('export const SUBMISSIONS'), '  [A-Z_]+')
  .map((t) => ({ ...t, name: PREFIX + snake(t.key) }));
const extra = entries(parseBlock('export const EXTRA_SUBMISSIONS'), '  \\[[A-Z_]+\\]')
  .map((t) => ({ ...t, name: t.key === 'VERIFY_CODE' ? `${PREFIX}verify_code` : `${PREFIX}cover_pending` }));
const ALL = [...main, ...extra];

const g = async (path, init) => {
  const r = await fetch(`${G}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(JSON.stringify(b.error?.error_user_msg || b.error?.message || b));
  return b;
};

const existing = new Map();
for (const t of (await g(`${waba}/message_templates?fields=name,status,language&limit=200`)).data ?? []) {
  existing.set(`${t.name}:${t.language}`, t.status);
}

console.log(`${ALL.length} templates to place on ${waba}${dry ? '  (dry run)' : ''}\n`);
let made = 0, skipped = 0, failed = 0;

for (const t of ALL) {
  const have = existing.get(`${t.name}:en`);
  if (have && have !== 'REJECTED') { console.log(`  · ${t.name.padEnd(28)} already ${have}`); skipped++; continue; }

  // An AUTHENTICATION template's body is fixed by Meta — you choose the
  // add-ons, not the words — so it is built differently from a utility one.
  const components = t.category === 'AUTHENTICATION'
    ? [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ]
    : [
        {
          type: 'BODY',
          text: t.body,
          ...(t.samples.length ? { example: { body_text: [t.samples] } } : {}),
        },
        ...(t.buttons.length
          ? [{ type: 'BUTTONS', buttons: t.buttons.map((b) => ({ type: 'QUICK_REPLY', text: b })) }]
          : []),
      ];

  const payload = { name: t.name, language: 'en', category: t.category, components };
  if (dry) {
    console.log(`  + ${t.name.padEnd(28)} ${t.category}  ${t.samples.length} sample(s)  ${t.buttons.length} button(s)`);
    made++;
    continue;
  }
  try {
    const r = await g(`${waba}/message_templates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    console.log(`  ✓ ${t.name.padEnd(28)} ${r.status ?? 'SUBMITTED'}`);
    made++;
  } catch (e) {
    console.log(`  ✗ ${t.name.padEnd(28)} ${e.message}`);
    failed++;
  }
}
console.log(`\n${made} submitted, ${skipped} already there, ${failed} failed.`);
