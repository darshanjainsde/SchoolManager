#!/usr/bin/env node
/**
 * Send ONE template message, and say exactly what Meta said back.
 *
 *   node scripts/whatsapp-send-test.mjs 9079784745 hello_world
 *   node scripts/whatsapp-send-test.mjs 9079784745 sckools_absence_notice \
 *     "Raffles Public School" "Ravi Sharma" "Thu 25 Sep 2026"
 *
 * This exists because "WhatsApp is not working" has at least four different
 * causes that look identical from inside the product — a dead token, a
 * template Meta has not approved, a number outside the allow-list while the
 * account is still limited, and a recipient who has never messaged the
 * business. Each one has a distinct Meta error code, and this prints it.
 *
 * Reads the permanent token from ~/.sckools-whatsapp-token and NEVER prints
 * it. Sends exactly one message per run, to the number you name.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const TOKEN_FILE = join(homedir(), '.sckools-whatsapp-token');
const token = (process.env.WHATSAPP_TOKEN || (() => {
  try { return readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; }
})()).trim();
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

const [rawTo, template = 'hello_world', ...vars] = process.argv.slice(2);

if (!token || !token.startsWith('EAA')) {
  console.error(`No usable token. Put the permanent token in ${TOKEN_FILE}, one line.`);
  process.exit(2);
}
if (!phoneId) { console.error('Need WHATSAPP_PHONE_NUMBER_ID in the environment.'); process.exit(2); }
if (!rawTo) { console.error('Usage: whatsapp-send-test.mjs <number> [template] [vars…]'); process.exit(2); }

/** A bare Indian mobile gets 91; anything already in full is left alone. */
const to = /^\d{10}$/.test(rawTo) ? `91${rawTo}` : rawTo.replace(/^\+/, '');
// `hello_world` is Meta's own sample and is en_US; ours are en.
const lang = template === 'hello_world' ? 'en_US' : (process.env.WHATSAPP_TEMPLATE_LANG || 'en');

const body = {
  messaging_product: 'whatsapp',
  to,
  type: 'template',
  template: {
    name: template,
    language: { code: lang },
    ...(vars.length
      ? { components: [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text })) }] }
      : {}),
  },
};

console.log(`→ ${template} (${lang}) to +${to}, ${vars.length} variable(s)`);

const res = await fetch(`https://graph.facebook.com/${V}/${phoneId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const out = await res.json().catch(() => ({}));

if (res.ok) {
  const m = out.messages?.[0];
  console.log(`✓ accepted by Meta — message id ${m?.id ?? '(none)'}`);
  console.log(`  status: ${m?.message_status ?? 'accepted'}`);
  console.log('  ACCEPTED IS NOT DELIVERED. Meta queues it; the webhook reports');
  console.log('  sent → delivered → read. A number that has never written to the');
  console.log('  business, or is not on the allow-list, fails AFTER this point.');
} else {
  const e = out.error ?? {};
  console.error(`✗ refused — HTTP ${res.status}`);
  console.error(`  code     ${e.code}${e.error_subcode ? ` / ${e.error_subcode}` : ''}`);
  console.error(`  message  ${e.message}`);
  if (e.error_data?.details) console.error(`  details  ${e.error_data.details}`);
  const HINT = {
    131030: 'The recipient is not on the allow-list. An account still in development can only message numbers added under API Setup → recipients.',
    132001: 'No such template on this WABA, or not approved in that language.',
    132000: 'The number of variables sent does not match the template.',
    131047: 'Outside the 24-hour window and not a template — only templates can open a conversation.',
    190: 'The token is expired or invalid.',
    100: 'A parameter is wrong — usually the phone number id or the template name.',
  }[e.code];
  if (HINT) console.error(`  meaning  ${HINT}`);
  process.exit(1);
}
