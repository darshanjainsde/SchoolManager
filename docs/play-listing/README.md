# Google Play listing — the source of truth

Everything Google reads about the Android app lives in Play Console, outside
this repo, and it rots silently. On 2 Oct 2026 the first production release was
rejected under the **Misleading Claims** policy because:

- the reviewer's sign-in note still said "enter the school code raffles", a
  screen removed on 6 Aug, so the reviewer never got past sign-in;
- the description sold web-only features (website, admissions, staff management);
- the screenshots showed that deleted screen.

So the text lives here, is reviewed with the code that changes it, and
`apps/mobile/src/__tests__/play-listing.test.ts` checks it on every `pnpm test`.

| File | Play Console field | Limit |
|---|---|---|
| `short-description.txt` | Grow users → Store listings → Default → Short description | 80 |
| `full-description.txt` | … → Full description | 4000 |
| `reviewer-note-teacher.txt` | Policy and programs → App content → Sign in details → **Teacher** (username `anjali.desai@raffles.edu`) → Any other information | 500 |
| `reviewer-note-family.txt` | … → Sign in details → **Parent / student** (username `RPS-00021`) → Any other information | 500 |
| `release-notes.txt` | Test and release → the release → Release notes (en-US) | 500 |

Both reviewer logins are on the Raffles demo school in **production**, which
uses the shared demo password. That password goes only in the console's
Password field, never in these files.

## When you must update this folder

- **Sign-in changes** (a field is renamed, a step is added or removed, the phone
  door is switched on): update both reviewer notes, then paste them into Play
  Console. The test fails if a quoted label no longer exists in
  `apps/mobile/src/app/(auth)/login.tsx`.
- **A feature is added to or removed from the app:** update `full-description.txt`
  and add or remove its row in the test's claim map. Never describe what only the
  website or the admin console does.
- **New data leaves the phone** (a new field, upload, SDK or permission): update
  the Data safety form in Play Console and `https://sckools.com/privacy`
  (`apps/web/app/privacy/page.tsx`) in the same PR.
- **Screenshots:** retake them from the build you submit, 9:16 at 1080×1920 or
  larger. Never lead with the sign-in screen.

## Data safety answers (as of vc23)

| Category | Type | Where in the app | Optional? |
|---|---|---|---|
| Personal info | Name | profile, staff "My account" | No |
| Personal info | Email address | sign-in (staff, teachers) | No |
| Personal info | Phone number | staff WhatsApp number; sign-in code when on | Yes |
| Personal info | User IDs | student code, session tokens | No |
| Personal info | Other info | staff PAN and UAN (My pay) | Yes |
| Financial info | User payment info | staff bank account + IFSC (My pay) | Yes |
| Financial info | Other financial info | fee payment claim: amount, date, UPI ref | Yes |
| Photos and videos | Photos | profile photo, payment screenshot, attachments | Yes |
| Files and docs | Files and docs | homework and form attachments | Yes |
| Messages | Other in-app messages | parent ↔ teacher, complaint box, diary sign-off | Yes |
| App info and performance | Crash logs, Diagnostics | Sentry (EU), 10% traces | No |
| Device or other IDs | Device or other IDs | push notification token | Yes |

Purpose for all: app functionality (plus account management for sign-in data,
and analytics for crash data). Nothing is shared for third parties' own use.
Encrypted in transit: yes. Deletion: `https://sckools.com/delete-account`.
