#!/usr/bin/env node
/**
 * Submit our message templates to a WhatsApp Business Account.
 *
 *   WHATSAPP_WABA_ID=… pnpm --filter @skoolos/api exec tsx ../../scripts/whatsapp-templates.mjs --dry
 *   WHATSAPP_WABA_ID=… pnpm --filter @skoolos/api exec tsx ../../scripts/whatsapp-templates.mjs [--only=name,name]
 *
 * The bodies, sample values and buttons come from the API's own
 * `templates.ts` (templateSubmissions()), not from the docs, so a
 * template can never be approved in a shape the code does not send. Templates
 * belong to the BUSINESS ACCOUNT, not to a number — moving to a new account
 * means submitting them again, which is why this exists as a script.
 *
 * Already-approved names are skipped rather than resubmitted. Reads the token
 * from ~/.sckools-whatsapp-token and never prints it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const G = `https://graph.facebook.com/${V}`;
const token = (process.env.WHATSAPP_TOKEN || (() => {
  try { return readFileSync(join(homedir(), '.sckools-whatsapp-token'), 'utf8').trim(); } catch { return ''; }
})()).trim();
const waba = process.env.WHATSAPP_WABA_ID;
const dry = process.argv.includes('--dry');
// --only=a,b submits just those names (e.g. a new tier's templates) and leaves
// the rest alone — useful while a category such as AUTHENTICATION is blocked.
const only = new Set(
  (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length).split(',').filter(Boolean),
);

if (!token.startsWith('EAA')) { console.error('No usable token in ~/.sckools-whatsapp-token.'); process.exit(2); }
if (!waba) { console.error('Need WHATSAPP_WABA_ID in the environment.'); process.exit(2); }

// The source of truth, imported — not parsed. Run through tsx so the TS
// registry is read as code: every template, by the NAME the code sends,
// including the narrow notice templates the old regex never saw.
import { templateSubmissions } from '../apps/api/src/common/notifications/whatsapp/templates.ts';
const ALL = templateSubmissions().filter((t) => only.size === 0 || only.has(t.name));
for (const name of only) {
  if (!ALL.some((t) => t.name === name)) { console.error(`No template named ${name} in templates.ts.`); process.exit(2); }
}

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
