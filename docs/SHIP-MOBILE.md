# Shipping the Sckools mobile app (EAS → Google Play)

Package: `com.sckools.app` (see `apps/mobile/app.config.ts`). This is the
ordered runbook to take the current `apps/mobile` code to Google Play Closed
testing, then Production. There is no OTA channel: every change ships as a new store build.

Everything below except step 0 requires **your** Expo account, Google Play
Console access, and a device — none of it can be run by an agent.

---

## Step 0 — PREREQUISITE: apply pending DB migrations

Two migrations already exist in the repo but have **not** been applied to
staging/prod yet. Testers cannot use attendance, push notifications, or
holidays until these are deployed against the API's database:

- `packages/db/prisma/migrations/20260722_050000_push_tokens`
- `packages/db/prisma/migrations/20260722_060000_holidays`

Check what's pending, then apply, per environment:

```bash
# from repo root, with DATABASE_URL / DIRECT_URL pointed at the target env
# (session-pooler URL for migrations — see memory: "DIRECT_URL for prisma CLI")
pnpm --filter @skoolos/db migrate:check    # confirms which migrations are pending
pnpm --filter @skoolos/db migrate:deploy   # applies them
```

Run this against **staging** first (`api.test.sckools.com`'s DB — Tokyo
Supabase project `uehgshnytylrjdclxxig`, session pooler `:5432`) to verify the
mobile app end-to-end, then against **prod** (Mumbai Supabase project
`oljrqinbjhpysgfwmtxw`, session pooler `:5432`) before Closed testing opens to
real testers. `packages/db/prisma/schema.prisma` is the source of truth if
you want to eyeball what these migrations add (`PushToken` model, `Holiday`
model).

**Do this before Step 3 (first build)** — otherwise `/me/push-token` and any
holiday-aware attendance screens will 500 against an unmigrated DB.

---

## Step 1 — EAS login + init

```bash
pnpm --filter @skoolos/mobile exec npx eas-cli login
pnpm --filter @skoolos/mobile exec npx eas-cli init
```

`eas init` creates (or links) the EAS project and prints a project ID
(UUID). **`eas init` cannot safely rewrite `app.config.ts`** (it's TypeScript,
not static JSON), so you must paste the ID in by hand:

Open `apps/mobile/app.config.ts` and replace **both** occurrences of
`REPLACE-WITH-EAS-PROJECT-ID` with the real ID:

```ts
const EAS_PROJECT_ID = 'REPLACE-WITH-EAS-PROJECT-ID'; // <- paste here
```

(It feeds both `updates.url` and `extra.eas.projectId` — one edit fixes
both.) Commit that change.

---

## Step 2 — confirm the API hosts in `eas.json`

`apps/mobile/eas.json` currently points:

- `build.internal.env.EXPO_PUBLIC_API_URL` → `https://api.test.sckools.com`
  (staging API, per project memory of the Vercel deployment)
- `build.production.env.EXPO_PUBLIC_API_URL` → `https://api.sckools.com`
  (prod API, custom domain wired in Vercel)

These are **not fabricated placeholders** — they're the currently-deployed
API hosts. Before your first build, verify both resolve and return `{db:ok,
redis:ok}`:

```bash
curl -s https://api.test.sckools.com/ready
curl -s https://api.sckools.com/ready
```

If either host has changed (new domain, staging torn down, etc.), edit
`eas.json` before building — a stale `EXPO_PUBLIC_API_URL` baked into a
build cannot be changed later without a new build (it's not covered by EAS
Update, since it's a build-time env var, not JS).

---

## Step 3 — first internal build (APK) + device verification

```bash
pnpm --filter @skoolos/mobile exec npx eas-cli build -p android --profile internal
```

When it finishes, EAS prints a download URL (and a QR code) for the `.apk`.

1. Install it on a physical Android device (download the APK, open it,
   allow "install from unknown sources" if prompted).
2. Launch the app, log in with a real staging/prod account.
3. Verify push registration: the app calls `POST /me/push-token` on launch
   (see `apps/mobile/src/lib/push.ts`) — confirm a `PushToken` row was
   created for that user (Prisma Studio or a DB query).
4. Send a manual test push from https://expo.dev/notifications using the
   device's Expo push token (visible in device logs / dev tools while the
   app is running).
5. Verify the **real** flow end-to-end: as a teacher/admin, mark a student
   absent → the guardian-email-linked account's device should receive a
   push notification within a few seconds.

Do not proceed to Play Console setup until this internal build round-trips
correctly — it's much cheaper to catch push/API issues here than after
uploading to a testing track.

---

## Step 4 — Play Console: create the app entry

1. https://play.google.com/console → **Create app**.
2. App name: `Sckools`. Default language, Free, App or Game → App.
3. Package name: if this is the first time this app is being registered on
   Play, the console will ask you to set the package — use `com.sckools.app`
   to match `apps/mobile/app.config.ts`. **If an app entry with a different
   package already exists in your Play Console from earlier experimentation,
   reconcile it now** (either delete the stray entry if unpublished, or
   update `app.config.ts`'s `android.package` / `ios.bundleIdentifier` to
   match the already-registered package — package name cannot be changed
   after the first upload).
4. Declarations: complete the initial "Set up your app" checklist items Play
   requires before any track accepts an upload (App access, Ads,
   Content rating, Target audience, News app, COVID-19 apps, Data safety —
   you'll do the substantive ones in Step 7, but Play won't let you upload
   until these sections exist in some state).

---

## Step 5 — Internal testing track: upload the `.aab`, verify install

Internal testing is the fastest track (no review, near-instant) — use it to
sanity-check the Play Console pipeline before committing to Closed testing.

1. Build a store-formatted artifact (internal testing still wants an
   `.aab`, unlike the `.apk` you used for the device check in Step 3):
   ```bash
   pnpm --filter @skoolos/mobile exec npx eas-cli build -p android --profile production
   ```
   Note: `eas.json`'s `production` profile has `autoIncrement: true`, so
   every build bumps the version code automatically — no manual bumping.
2. Play Console → **Testing → Internal testing → Create new release**.
3. Upload the `.aab` EAS produced (download it from the EAS build page, or
   use `eas submit` — see Step 9).
4. Add release notes, save, **Review release**, **Start rollout to Internal
   testing**.
5. Add yourself as an internal tester (your own Play Console account email
   under the Internal testing → Testers tab), open the opt-in link on your
   device, install from Play, confirm it launches and matches the Step 3
   build.

---

## Step 6 — promote to Closed testing

1. Play Console → **Testing → Closed testing** → create a new closed track
   (e.g. "Closed testing – Sckools testers").
2. Create a **Google Group** (groups.google.com) for testers, e.g.
   `sckools-testers@googlegroups.com`. Add all **12 testers'** email
   addresses to the group (Play's minimum for the 14-day closed-testing
   requirement before applying for production access is 12 testers, opted
   in for 14 continuous days).
3. In the Closed testing track's **Testers** tab, choose "Google Group" and
   paste the group's email/URL.
4. Promote the release you uploaded in Step 5 (or upload a fresh `.aab`) to
   this Closed testing track, roll it out.
5. Copy the **opt-in URL** the console shows and post it in the Google
   Group (or email it directly to all 12 testers).
6. **Have all 12 testers open the opt-in link and install the app.** The
   14-day countdown for production-access eligibility only starts once
   testers have actually opted in — confirm in the console (Testers tab
   shows opt-in count) before considering the clock started. Track the
   start date somewhere durable; you'll need 14 continuous days before
   Step 8.

---

## Step 7 — the Play Console listing and declarations

**Everything Google reads lives in [`docs/play-listing/`](play-listing/README.md)**:
the short and full description, the reviewer sign-in notes, the release notes and
the Data safety answers. Paste from there; never type listing text straight into
Play Console. `apps/mobile/src/__tests__/play-listing.test.ts` fails if:

- a text goes over Play's limit;
- a reviewer note quotes a sign-in label the app does not have, or asks for a school code;
- the description claims a feature with no screen in the app, or names a web-only feature.

The first production release (vc18) was rejected on 2 Oct 2026 under the
Misleading Claims policy for exactly these drifts. See the README for the story.

Before every submission:

1. **Sign in details** (App content): two entries, **Teacher** and **Parent / student**,
   with the notes from `docs/play-listing/`. Walk them on the build you submit.
2. **Data safety** matches the table in `docs/play-listing/README.md` and
   <https://sckools.com/privacy> (`apps/web/app/privacy/page.tsx`). If new data
   leaves the phone, update all three in one PR.
3. **Account deletion URL**: <https://sckools.com/delete-account>.
4. **Target audience**: students log in, so children are users and the Families
   policy applies. Don't declare 18+ only.
5. **Content rating**: parents and teachers message each other, so answer "users
   can interact" truthfully.
6. **Screenshots** from the submitted build, 9:16 at 1080×1920 or larger, never
   leading with the sign-in screen.
7. **The release holds the build you mean.** Check the version code in Publishing
   overview before pressing Send. A stale draft (vc18) once sat there for two months.

---

## Step 8 — after 14 days: apply for production access

1. Confirm in Play Console that all 12 testers have been opted in
   continuously for 14 days (Console surfaces eligibility once met — check
   **Testing → Closed testing → Production access** or similar prompt).
2. Play Console → apply for production access. This triggers Google's
   app review (can take hours to a few days).
3. Once approved, go to **Production** track → create a new release →
   promote the tested `.aab` (or upload a new build).

---

## Step 9 — staged rollout: 10% → 50% → 100%

Do **not** roll out to 100% immediately:

1. Production release → set rollout percentage to **10%**. Start rollout.
2. Monitor Play Console's crash/ANR dashboards and your own API logs for a
   day or two. Watch for elevated error rates on `/me/push-token`,
   `/me/attendance`, `/notices`, etc.
3. If stable, increase to **50%**, monitor again.
4. If stable, increase to **100%**.

You can halt/roll back a staged rollout from the Play Console at any
percentage if issues surface.

`eas submit` can automate the upload-to-Play part of Steps 5/6/8 once you've
configured a Play service account JSON and referenced it under
`submit.production` in `eas.json` (currently empty — `eas submit -p android
--profile production` will prompt you to set this up interactively the
first time):

```bash
pnpm --filter @skoolos/mobile exec npx eas-cli submit -p android --profile production
```

---

## Over-the-air updates: not available

`app.config.ts` carries an `updates.url`, but **`expo-updates` is not installed**,
so `eas update` reaches nobody. Every change, JS-only or not, ships as a new
store build: EAS production build → Internal testing → Closed testing → Production.
Installing `expo-updates` needs a native build and its own device test.

---

## iOS — deferred

This runbook covers Android/Play Console only. `apps/mobile/app.config.ts`
already sets `ios.bundleIdentifier: 'com.sckools.app'` and `eas.json`'s
profiles are Android-only (`android.buildType`) — an iOS build profile
(`ios: { simulator: false }` under each profile, plus Apple Developer
Program enrollment, App Store Connect app record, and `eas submit -p ios`
with an App Store Connect API key) is a separate, later task. Do not start
it until Android Closed testing is stable — the code is shared, only the
build/submit config differs.

---

## Quick reference: command order

```bash
# 0. prerequisite (staging, then prod, before any real tester touches the app)
pnpm --filter @skoolos/db migrate:deploy

# 1. one-time EAS setup
pnpm --filter @skoolos/mobile exec npx eas-cli login
pnpm --filter @skoolos/mobile exec npx eas-cli init
#    -> paste projectId into apps/mobile/app.config.ts (EAS_PROJECT_ID), commit

# 3. verify on a real device
pnpm --filter @skoolos/mobile exec npx eas-cli build -p android --profile internal

# 5/6/8. store builds (autoIncrement handles version codes)
pnpm --filter @skoolos/mobile exec npx eas-cli build -p android --profile production
pnpm --filter @skoolos/mobile exec npx eas-cli submit -p android --profile production

# ongoing: no OTA (expo-updates not installed) — every change is a new store build
```
