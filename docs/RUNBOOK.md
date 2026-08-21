# Sckools Runbook — school #1 launch

Launch-gate #7: the written path to every mechanism that already exists.
One page per scenario: **symptom → check → action → verify**. Keep this file
honest — when an incident teaches you something, write it in the same day.

---

## Part 1 · One-time setup (the launch-gate switches)

Do these once, before school #1. Code for all of them is already in `main`
once the launch-gate branch lands; each needs an account-side switch:

| # | Gate | Where | What to do |
|---|------|-------|------------|
| 2 | Real email | ESP + DNS | Create a Resend (or SES) account → add sending domain `mail.sckools.com` → set the DKIM/SPF/Return-Path DNS records it gives you → copy the SMTP credentials into Vercel (`skoolos-api` env): `SMTP_HOST`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM="Sckools <no-reply@mail.sckools.com>"`. MailService is transport-agnostic — env only, no deploy needed beyond the env change. Send a test invite to yourself and check Gmail's "show original" for `dkim=pass spf=pass`. |
| 3 | Backups | Supabase + GitHub | Supabase dashboard → Database → enable **PITR**. GitHub repo → Settings → Secrets → add `DB_BACKUP_URL` (the SESSION pooler string, port 5432 — the transaction pooler breaks pg_dump). Optionally add the `BACKUP_S3_*` secrets for a true offsite copy. Then run the **Restore drill** below once. |
| 4 | Alerts | Sentry + UptimeRobot | Create a Sentry project (Node) → copy the DSN into Vercel env `SENTRY_DSN` on BOTH `skoolos-api` and `skoolos-web`. Create two UptimeRobot monitors: `https://api.sckools.com/ready` and the school's homepage, alerting your phone/email at 2-minute intervals. |
| 5 | Rate limits | — | Nothing to do — ships with the code (`REDIS_URL` already set). Verify below. |
| 6 | Fast outbox | GitHub | Repo → Settings → Secrets → add `CRON_SECRET` (same value as the Vercel env). The `outbox-drain` workflow then runs every 10 minutes. Verify: Actions tab shows green runs; `SELECT count(*) FROM "NotificationOutbox" WHERE "sentAt" IS NULL` stays near zero. |
| 8 | Privacy | — | `sckools.com/privacy` + `/terms` are live and linked from every school-site footer. Get a lawyer pass before the first PAID contract. |

---

## Part 2 · Onboarding checklist (per school)

Half a day of work when the school's data arrives clean. Order matters.

1. **Provision the school** in the owner console (school row + subdomain).
2. **Admin account** for the school office; log in as them for the rest.
3. **Class structure**: create academic year, grades, class sections
   (Console → Classes). The import script needs the sections to exist.
4. **Staff** next (Console → Teachers): create + invite the teachers.
5. **Students in bulk** — the import script:
   ```bash
   # Ask the school for Excel → save as CSV with headers:
   # admission_no,first_name,last_name,class,section,roll_no,guardian_name,guardian_phone,email
   export SKOOLOS_ADMIN_PASSWORD='…'
   node scripts/import-students.mjs --file students.csv \
     --host <school>.sckools.com --email <admin email>        # DRY RUN first
   node scripts/import-students.mjs --file students.csv \
     --host <school>.sckools.com --email <admin email> --commit
   ```
   The dry run validates every row and names any missing class section.
   The final report lists any row whose **invite email failed** — resend
   those from Console → Students → Resend invite.
6. **Website content**: Studio (theme/design), Homepage/About/Contact tabs,
   gallery photos, admissions steps. Publish.
7. **Verify as a parent**: open the public site logged-out; register for an
   event; submit an enquiry; log in as one imported student.
8. **Hand over**: give the office the admin credentials sheet and the
   support contact (you), and note the school in your own tracking.

---

## Part 3 · Scenario pages

### "I can't log in" (staff / student / parent)
- **Check**: Console → Students (or Teachers) → find the person. Invite sent?
  Email correct? Sentry for auth 500s; UptimeRobot for API downtime.
- **Action**: Resend invite (sets a fresh set-password link). Wrong email →
  fix the email, then resend. Locked out by rate limit → wait 1 minute
  (limits are per-minute windows).
- **Verify**: user logs in; audit log shows the successful login.

### "Parents didn't get the push / got it a day late"
- **Check**: GitHub → Actions → `Drain notification outbox` — green in the
  last 10 min? `NotificationOutbox` unsent count. Expo push receipts in logs.
- **Action**: If the workflow is red: check `CRON_SECRET` matches Vercel.
  Run it manually (workflow_dispatch). If Expo errors: the device token may
  be stale — the next app open refreshes it.
- **Verify**: unsent count drains; send yourself a test notice.

### "Invite emails aren't arriving"
- **Check**: Sentry `kind: mail` events (transport failures are captured —
  domain only, no addresses). ESP dashboard delivery/bounce stats.
- **Action**: Transport auth failure → rotate `SMTP_PASS`. Bounces → fix
  recipient addresses with the school. Spam-foldering → confirm
  `dkim=pass spf=pass` on a Gmail "show original"; warm up volume gradually.
- **Verify**: resend one invite to a test Gmail; lands in inbox.

### "Wrong marks / attendance were published"
- **Check**: audit log (Console → Audit) for who changed what, when.
- **Action**: correct the data in the console (it keeps history via audit);
  if a broadcast notice went out, send a follow-up notice with the
  correction. For bulk damage, see the Restore drill — PITR can rewind a
  table's mistake window, but weigh losing writes made since.
- **Verify**: portal shows corrected values; school confirms.

### "The site is down / slow"
- **Check**: UptimeRobot status; Vercel deploy dashboard (bad deploy?);
  Supabase status page; Sentry error spike.
- **Action**: Bad deploy → Vercel → instant rollback to previous. Database
  incident → Supabase dashboard/status. Traffic spike on a school site →
  it's SSR, so check function invocation graphs; nothing to panic-scale for
  one school.
- **Verify**: /ready is green, page loads logged-out from a phone.

### "A parent asks to delete their / their child's data"
- **Check**: is it an ACCOUNT deletion (parent's own login) or a STUDENT
  record request? Student records belong to the school (DPDP fiduciary).
- **Action**: account → point at sckools.com/delete-account or delete from
  the console. Student record → get the school's written instruction, then
  suspend-then-delete the student in the console.
- **Verify**: login fails; personal data no longer renders in portals; note
  the request + action + date in your records.

### Restore drill (do once at setup, then after any schema epoch)
1. Nightly backup artifact (or S3 object) → download the latest
   `skoolos-*.dump.gz`.
2. Create a THROWAWAY Postgres (local Docker or a scratch Supabase project):
   `createdb restore_drill && gunzip -c skoolos-….dump.gz | pg_restore -d restore_drill --no-owner`
3. Sanity queries: counts on `School`, `Student`, `User`, `AttendanceRecord`
   match production's same-day counts (±the day's writes).
4. Time it. Write the number here: restore takes ≈ ____ minutes.
5. PITR path: Supabase dashboard → Database → PITR → note (do NOT run) the
   restore-to-timestamp flow so you have seen the screen before an incident.

### Verify the shared rate limiter (gate 5, once after deploy)
```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://api.sckools.com/auth/login \
  -H 'content-type: application/json' -H 'x-skoolos-host: <school>.sckools.com' \
  -d '{"identifier":"probe@example.com","password":"x"}'; done
# Expect 401s turning into 429 at request 11 — and staying 429 across
# repeated runs (shared counter), not resetting per lambda instance.
```

---

## Part 4 · Contacts & links

- Vercel dashboard: team finokraft → skoolos-web / skoolos-api
- Supabase: project dashboard (DB, PITR, storage)
- Sentry: project dashboard (alerts → your email/phone)
- UptimeRobot: monitors `/ready` + school homepage
- ESP (Resend/SES): delivery dashboard
- GitHub Actions: `outbox-drain`, `db-backup` (both have workflow_dispatch
  for manual runs)
