#!/usr/bin/env node
/**
 * Submit `sckools_verify_code` — the one template OTP needs.
 *
 * Meta FIXES the body for the AUTHENTICATION category: you do not send your
 * own words, you declare the security line, the expiry and the copy-code
 * button, and Meta writes the rest in every language it supports. That is why
 * this cannot be created from `SUBMISSIONS[VERIFY_CODE].body` like the others.
 *
 *   WHATSAPP_WABA_ID=… node scripts/whatsapp-submit-verify-code.mjs
 *
 * Submitting asks Meta to REVIEW a template; it does not message anybody.
 * Safe to re-run — an existing template comes back as a duplicate error.
 * Reads the token from ~/.sckools-whatsapp-token and never prints it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const token = (process.env.WHATSAPP_TOKEN || (() => {
  try { return readFileSync(join(homedir(), '.sckools-whatsapp-token'), 'utf8').trim(); } catch { return ''; }
})()).trim();
const waba = process.env.WHATSAPP_WABA_ID;
if (!token || !waba) { console.error('Need the token file and WHATSAPP_WABA_ID.'); process.exit(2); }

const body = {
  name: 'sckools_verify_code',
  language: 'en',
  category: 'AUTHENTICATION',
  // `message_send_ttl_seconds` matches our own 10-minute code life: Meta will
  // not keep trying to deliver a code that has already expired.
  message_send_ttl_seconds: 600,
  components: [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 10 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
  ],
};

const res = await fetch(`https://graph.facebook.com/${V}/${waba}/message_templates`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const out = await res.json().catch(() => ({}));

if (res.ok) {
  console.log(`✓ submitted — id ${out.id}, status ${out.status}, category ${out.category}`);
  console.log('  APPROVED here means it can be sent. PENDING means Meta is still reading it;');
  console.log('  authentication templates are usually decided in minutes, not days.');
} else {
  const e = out.error ?? {};
  console.error(`✗ refused — HTTP ${res.status}`);
  console.error(`  code     ${e.code}${e.error_subcode ? ` / ${e.error_subcode}` : ''}`);
  console.error(`  message  ${e.message}`);
  if (e.error_user_title) console.error(`  title    ${e.error_user_title}`);
  if (e.error_user_msg) console.error(`  detail   ${e.error_user_msg}`);
  process.exit(1);
}
