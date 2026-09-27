#!/usr/bin/env node
/**
 * Set the WhatsApp business profile on OUR number: the Sckools logo as the
 * photo, plus the about line, description, website and email a family sees
 * when they open the chat header. Runs against Meta's Graph API with the
 * same env the API uses — nothing is stored here.
 *
 *   WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… META_APP_ID=… \
 *     node scripts/whatsapp-profile.mjs docs/whatsapp/profile-photo.png
 *   node scripts/whatsapp-profile.mjs --show        # read what Meta has now
 *
 * Photo: square PNG/JPEG, 640×640 recommended, under 5 MB. The DISPLAY NAME
 * is not set here — it is set once per number in WhatsApp Manager and Meta
 * reviews it; a test number keeps Meta's own name.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const V = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
// The token comes from the environment, or from a private file in the home
// folder (~/.sckools-whatsapp-token) so it never has to be typed into a chat
// or a shell history. Either way it is never printed.
const TOKEN_FILE = join(homedir(), '.sckools-whatsapp-token');
function tokenFromFile() {
  try { return readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; }
}
const token = (process.env.WHATSAPP_TOKEN || tokenFromFile()).trim();
const pnid = process.env.WHATSAPP_PHONE_NUMBER_ID;
const appId = process.env.META_APP_ID;
const G = `https://graph.facebook.com/${V}`;
const args = process.argv.slice(2);
if (!token || !token.startsWith('EAA') || token.includes('...')) {
  console.error(`No usable token. Put the permanent token (starts with EAA) in ${TOKEN_FILE}, one line, nothing else.`);
  process.exit(2);
}
if (!pnid) { console.error('Need WHATSAPP_PHONE_NUMBER_ID in the environment.'); process.exit(2); }

async function graph(path, init = {}) {
  const res = await fetch(`${G}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body.error || body)}`);
  return body;
}

async function show() {
  const r = await graph(`${pnid}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`);
  console.log(JSON.stringify(r.data?.[0] ?? r, null, 2));
}

async function uploadPhoto(file) {
  if (!appId) throw new Error('META_APP_ID is needed to upload a photo (Resumable Upload API).');
  const bytes = await readFile(file);
  const type = file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  const session = await graph(`${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(type)}&file_name=${encodeURIComponent(basename(file))}`, { method: 'POST' });
  const res = await fetch(`${G}/${session.id}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': type }, body: bytes });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.h) throw new Error(`upload → ${res.status} ${JSON.stringify(out)}`);
  return out.h;
}

async function set(file) {
  const profile = {
    messaging_product: 'whatsapp',
    about: 'School updates from Sckools — attendance, diary, tests, results, fees.',
    description: 'Sckools sends your school\'s notices on WhatsApp: attendance, diary remarks, tests and results, announcements and fee reminders. Replies are read by your school, not by Sckools.',
    vertical: 'EDU',
    websites: ['https://sckools.com'],
    email: 'hello@sckools.com',
  };
  if (file) profile.profile_picture_handle = await uploadPhoto(file);
  const r = await graph(`${pnid}/whatsapp_business_profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
  console.log('profile updated:', JSON.stringify(r));
  await show();
}

try {
  if (args.includes('--show')) await show();
  else await set(args.find((a) => !a.startsWith('--')));
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
