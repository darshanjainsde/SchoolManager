#!/usr/bin/env node
/**
 * Read back what Meta actually has for our WhatsApp setup, so "I did the
 * steps" can be checked rather than believed.
 *
 *   node scripts/whatsapp-verify.mjs
 *
 * Reads the permanent token from ~/.sckools-whatsapp-token (never prints it)
 * and reports, for the business account in WHATSAPP_WABA_ID:
 *   - every phone number on it: display name and whether Meta approved it,
 *     the quality rating, and the messaging limit (the thing that says
 *     whether you are still stuck on a test list)
 *   - whether the owning business is verified, which is what lifts that limit
 *   - every message template and its review status
 *
 * Nothing here writes. It is safe to run at any time.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const G = `https://graph.facebook.com/${V}`;
const TOKEN_FILE = join(homedir(), '.sckools-whatsapp-token');
const token = (process.env.WHATSAPP_TOKEN || (() => {
  try { return readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; }
})()).trim();
const waba = process.env.WHATSAPP_WABA_ID;

if (!token || !token.startsWith('EAA') || token.includes('...')) {
  console.error(`No usable token. Put the permanent token (starts with EAA) in ${TOKEN_FILE}, one line, nothing else.`);
  process.exit(2);
}
if (!waba) { console.error('Need WHATSAPP_WABA_ID in the environment.'); process.exit(2); }

async function graph(path) {
  const res = await fetch(`${G}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path.split('?')[0]} → ${res.status} ${JSON.stringify(body.error?.message || body)}`);
  return body;
}

const tick = (ok) => (ok ? '✓' : '✗');
const line = (s = '') => console.log(s);

try {
  // ── the business account, and who owns it ──────────────────────────────
  const acct = await graph(`${waba}?fields=id,name,timezone_id,message_template_namespace,account_review_status,owner_business_info`);
  line(`Business account   ${acct.name ?? waba}`);
  line(`  review status    ${acct.account_review_status ?? 'unknown'}`);

  const ownerId = acct.owner_business_info?.id;
  if (ownerId) {
    try {
      const biz = await graph(`${ownerId}?fields=id,name,verification_status`);
      const verified = biz.verification_status === 'verified';
      line(`  business         ${biz.name}`);
      line(`  ${tick(verified)} verification   ${biz.verification_status ?? 'unknown'}${verified ? '' : '  ← this is what keeps you on the test list'}`);
    } catch (e) {
      line(`  business         could not read (${e.message})`);
    }
  }

  // ── the numbers ────────────────────────────────────────────────────────
  line();
  const nums = await graph(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,name_status,code_verification_status,quality_rating,messaging_limit_tier,platform_type,status&limit=50`);
  const rows = nums.data ?? [];
  line(`Numbers on this account: ${rows.length}`);
  for (const n of rows) {
    // APPROVED = a reviewer passed it; AVAILABLE_WITHOUT_REVIEW = it never
    // needed one. Both mean the name a family sees is the one we set.
    const nameOk = n.name_status === 'APPROVED' || n.name_status === 'AVAILABLE_WITHOUT_REVIEW';
    const codeOk = n.code_verification_status === 'VERIFIED';
    line();
    line(`  ${n.display_phone_number}`);
    line(`    phone number id  ${n.id}`);
    line(`    ${tick(nameOk)} display name   ${n.verified_name ?? '—'}  (${n.name_status ?? 'unknown'})`);
    line(`    ${tick(codeOk)} code verified  ${n.code_verification_status ?? 'unknown'}`);
    line(`      quality        ${n.quality_rating ?? '—'}`);
    line(`      messaging tier ${n.messaging_limit_tier ?? '—'}`);
    line(`      status         ${n.status ?? '—'}`);
    try {
      const p = await graph(`${n.id}/whatsapp_business_profile?fields=about,description,email,websites,profile_picture_url,vertical`);
      const prof = p.data?.[0] ?? {};
      line(`    ${tick(!!prof.profile_picture_url)} photo set`);
      line(`    ${tick(!!prof.about)} about          ${prof.about ?? '—'}`);
      line(`    ${tick(!!(prof.websites || []).length)} website        ${(prof.websites || []).join(', ') || '—'}`);
    } catch (e) {
      line(`      profile        could not read (${e.message})`);
    }
  }

  // ── the templates ──────────────────────────────────────────────────────
  line();
  const tpl = await graph(`${waba}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`);
  const list = tpl.data ?? [];
  line(`Templates: ${list.length}`);
  const by = new Map();
  for (const t of list) by.set(`${t.name} (${t.language})`, t);
  for (const [k, t] of [...by].sort()) {
    // PENDING is not a failure, it is Meta still reading it.
    const ok = t.status === 'APPROVED' || t.status === 'PENDING';
    line(`  ${tick(ok)} ${k.padEnd(38)} ${t.status}${t.rejected_reason && t.rejected_reason !== 'NONE' ? `  — ${t.rejected_reason}` : ''}  [${t.category}]`);
  }
} catch (e) {
  console.error(`\nFailed: ${e.message}`);
  console.error('If this says the token is invalid, the token in the file is still the old one.');
  process.exit(1);
}
