/**
 * Proves the cross-school event-registration policies do what the migration
 * claims. Run against a NON-PRODUCTION database:
 *
 *   node packages/db/scripts/verify-event-rls.mjs
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST. Row-level security is enforced by
 * Postgres, not by application code — a jest test with a mocked `tx` proves
 * nothing about it at all. The only way to know an outsider cannot read a
 * host's attendee list is to connect as the RLS-bound role and try. It reads
 * its connection from ~/Desktop/staging-mumbai/db.env and refuses to touch
 * production.
 *
 * The assertion that matters most is "outsider CANNOT read the host's attendee
 * list". The cross-school insert is a deliberate hole in tenant isolation; this
 * script is what keeps that hole exactly the size it was designed to be.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/darshanjain/Worktrees/SchoolManager-parity/packages/db/');
const { Client } = require('pg');

const env = {};
for (const l of readFileSync(process.env.HOME + '/Desktop/staging-mumbai/db.env','utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m) env[m[1]] = m[2];
}
// The app role is the one RLS actually applies to.
const url = env.DIRECT_URL.replace('postgres:', 'skoolos_app:').replace(/\/\/skoolos_app:[^@]*@/, '//skoolos_app:skoolos_app_pw@');
if (/oljrqinbjhpysgfwmtxw/.test(url)) {
  console.error('\u2717 That is the PRODUCTION database. Refusing.');
  process.exit(1);
}

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const HOST = '2ce97b3d-71a1-499a-ab25-fe999ce29709'; // Raffles
const OTHER = '00000000-0000-0000-0000-0000000000aa'; // pretend visitor school
let failures = 0;
const ok = (n, cond) => {
  if (!cond) failures++;
  console.log((cond ? 'PASS ' : 'FAIL ') + n);
};
let evId, ttId;

async function asTenant(t, fn) {
  await c.query('BEGIN');
  await c.query(`SELECT set_config('app.current_tenant', $1, true)`, [t]);
  try { return await fn(); } finally { await c.query('COMMIT').catch(()=>c.query('ROLLBACK')); }
}

// Host creates a NETWORK, APPROVED event with a free ticket type.
await asTenant(HOST, async () => {
  const e = await c.query(`INSERT INTO "Event"("id","schoolId","title","startAt","scope","status","originSchoolName")
    VALUES (gen_random_uuid(),$1,'RLS probe event',now(),'NETWORK','APPROVED','Raffles') RETURNING id`, [HOST]);
  evId = e.rows[0].id;
  const t = await c.query(`INSERT INTO "EventTicketType"("id","eventId","schoolId","name","priceMinor")
    VALUES (gen_random_uuid(),$1,$2,'Free',0) RETURNING id`, [evId, HOST]);
  ttId = t.rows[0].id;
  await c.query(`INSERT INTO "EventRegistration"("id","eventId","schoolId","ticketTypeId","guestEmail","guestName")
    VALUES (gen_random_uuid(),$1,$2,$3,'host-attendee@example.com','Host Attendee')`, [evId, HOST, ttId]);
});
ok('host can create its own event, ticket type and registration', !!evId && !!ttId);

// A different school registers one of its students for that network event.
let inserted = false;
await asTenant(OTHER, async () => {
  try {
    await c.query(`INSERT INTO "EventRegistration"("id","eventId","schoolId","ticketTypeId","fromSchoolId","guestEmail","guestName")
      VALUES (gen_random_uuid(),$1,$2,$3,$4,'visitor@example.com','Visitor')`, [evId, HOST, ttId, OTHER]);
    inserted = true;
  } catch (e) { console.log('   insert error:', e.message.slice(0,90)); }
});
ok('an outside school CAN register for a NETWORK+APPROVED event', inserted);

// THE ONE THAT MATTERS: it must not be able to read the host's attendees.
await asTenant(OTHER, async () => {
  const r = await c.query(`SELECT "guestEmail" FROM "EventRegistration" WHERE "eventId"=$1`, [evId]);
  const emails = r.rows.map(x=>x.guestEmail);
  ok('outsider CANNOT read the host\'s attendee list', !emails.includes('host-attendee@example.com'));
  ok('outsider CAN read back only its own registration', emails.includes('visitor@example.com') && emails.length === 1);
});

// And it must not be able to file a row claiming to be from a school it isn't.
let spoofed = false;
await asTenant(OTHER, async () => {
  try {
    await c.query(`INSERT INTO "EventRegistration"("id","eventId","schoolId","ticketTypeId","fromSchoolId","guestEmail")
      VALUES (gen_random_uuid(),$1,$2,$3,$4,'spoof@example.com')`, [evId, HOST, ttId, HOST]);
    spoofed = true;
  } catch { /* expected */ }
});
ok('outsider CANNOT forge fromSchoolId to another school', !spoofed);

// A SCHOOL-scope event must not be registerable by outsiders at all.
let priv = null, privLeak = false;
await asTenant(HOST, async () => {
  const e = await c.query(`INSERT INTO "Event"("id","schoolId","title","startAt","scope","status")
    VALUES (gen_random_uuid(),$1,'Private event',now(),'SCHOOL','APPROVED') RETURNING id`, [HOST]);
  priv = e.rows[0].id;
});
await asTenant(OTHER, async () => {
  try {
    await c.query(`INSERT INTO "EventRegistration"("id","eventId","schoolId","ticketTypeId","fromSchoolId","guestEmail")
      VALUES (gen_random_uuid(),$1,$2,$3,$4,'nope@example.com')`, [priv, HOST, ttId, OTHER]);
    privLeak = true;
  } catch { /* expected */ }
});
ok('outsider CANNOT register for a SCHOOL-scope (private) event', !privLeak);

// Clean up the probe rows.
await asTenant(HOST, async () => {
  await c.query(`DELETE FROM "Event" WHERE id = ANY($1::uuid[])`, [[evId, priv]]);
});
await c.end();

// Exit non-zero if anything failed, so this can gate a deploy rather than
// merely printing to a terminal nobody is reading.
if (failures > 0) {
  console.error(`\n\u2717 ${failures} RLS assertion(s) failed — do NOT ship this migration.`);
  process.exit(1);
}
console.log('\n\u2713 every RLS assertion held.');
