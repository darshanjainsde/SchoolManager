# Android App — Launch Prerequisites (start today, user actions)

> **RESEQUENCED 2026-07-21:** Web ships first and app-independent — see `2026-07-21-web-first-portals.md`. The Android app (Expo) is now Phase 2B: a launch *event* that reuses the web's Attendance/Exam/Result API, gated only by Google's account/testing clocks below.

The mobile implementation plan (Expo Teacher + Student/Parent apps) is written AFTER these accounts exist, because package name, Firebase project and signing identity go into the code. Everything below can be started today; items marked ⏳ have waiting periods you cannot compress — start them first.

## Decisions already locked (from brainstorming)
- Expo (React Native, TypeScript) — one codebase, reuses NestJS API + `@skoolos/types`.
- v1 roles: Teacher + Student/Parent (student login doubles as parent login).
- Notifications: FCM push now, channel-abstracted for WhatsApp later.
- Backend gaps to build first: Attendance, Exam, Result, PushDevice models + endpoints (these become "Phase 2B plan" — written after Admin Pro console Task list is underway, since teacher app consumes the same timetable/roster APIs).

## Do today (user)

- [ ] ⏳ **Google Play Console developer account** — play.google.com/console, one-time **$25**. Decide account type NOW:
  - **Organization account (recommended)**: needs a **D-U-N-S number** (free, days–weeks in India) + business docs, but avoids the personal-account testing rule below and looks right to schools.
  - **Personal account**: instant, but accounts created after Nov 2023 must run a closed test with **12 testers for 14 consecutive days** before production access — that alone sets your minimum launch timeline.
- [ ] ⏳ **Identity verification** in Play Console (ID + address; org: docs + D-U-N-S). Days.
- [ ] **Reserve the app identity**: package name `com.sckools.app` (cannot change after first upload), app name "SkoolOS" (or "Sckools — School App").
- [ ] **Firebase project** (free): console.firebase.google.com → project `sckools-app` → add Android app with the package name → download `google-services.json` (needed for FCM).
- [ ] **Expo account** (free) at expo.dev + `npm i -g eas-cli`; EAS free tier builds are queued — the **$19/mo plan** is worth it during launch month for priority builds.
- [ ] **Privacy policy URL** — mandatory for Play listing. We'll generate `sckools.com/privacy` as a page in the marketing app (15-min task, can be done in this repo today).
- [ ] **Store listing assets**: 512×512 icon, 1024×500 feature graphic, ≥4 phone screenshots (we generate these from the app once built), short + full description.
- [ ] **Data safety form answers** (we draft; you submit): collects name, attendance, academic records; encrypted in transit; no ads; no data sold.
- [ ] **12 testers** lined up (personal account path): friendly school staff/family Gmail addresses.

## Realistic timeline (personal account, worst case)
Account+verification (2–3 d) → app built & closed testing (Phase 2B, ~3–4 wks in parallel) → 14-day closed test → production review (1–7 d). **The 14-day test is the floor — "launching today" means starting the clock today, which is exactly what the list above does.**

## Costs summary
| Item | Cost |
|---|---|
| Play Console | $25 one-time |
| Firebase / FCM | free |
| Expo EAS | free tier or $19/mo |
| Apple (deferred) | $99/yr when iOS ships |
| GST | not required to build or publish; required when invoicing schools (or >₹20L turnover) — confirm with CA |
