---
name: sckools-expert
description: The complete, file-cited knowledge base of Sckools (the SkoolOS monorepo) — architecture, every API route, data model, web/mobile surfaces, feature catalogue by desk, tiers, conventions and guards, environments and deploy process, business context (plans, pricing, marketing site). Use it to answer any question about how the product works or is built, to plan or review a change, to onboard, or to write copy/docs/pitches that must be accurate. Refresh it with the sckools-expert-update skill after shipping a feature.
---

# Sckools Expert

Everything about the product and the codebase, structured so you can find the one file you need. Machine-derived
tables are regenerated from the tree (`references/inventory/`, stamped in `inventory/STATE.json`); the narrative
files are curated and cite the files that hold the truth. **When code and this skill disagree, the code wins —
and the skill gets fixed in the same change** (run `/sckools-expert-update`).

## Use it like this

| You need | Open |
|---|---|
| How a request flows, what talks to what, where things run | `references/architecture.md` |
| What a feature does, which plan has it, which screens show it | `references/feature-catalog.md` |
| Exact routes, guards, roles, feature gates | `references/inventory/api-routes.md` |
| Tables, relations, uniques, which tenant tables lack RLS | `references/inventory/data-model.md` |
| Web pages, middleware, rewrites; mobile screens | `references/inventory/web-routes.md`, `references/inventory/mobile-routes.md` |
| Tiers, feature keys, overrides | `references/inventory/features.md` |
| How to work here without repeating a paid-for mistake | `references/conventions.md` |
| Environments, hosts, deploys, migrations, demo data, incidents | `references/operations.md`, `references/inventory/workflows.md`, `references/inventory/env.md` |
| Plans, pricing, marketing site, leads, sales, brand | `references/business.md` |
| What changed recently and why | `references/changelog.md`, `references/inventory/migrations.md` |
| Every document in the repo | `references/inventory/docs-index.md` |
| "Is this behaviour a bug?" and QA scope | the sibling skill `.claude/skills/sckools-behavior-spec/` |

Answer with the file that holds the rule. If money, marks, attendance or tenant isolation are involved, open the
cited source before asserting — this is a map, not the territory.

## The product in one screen

Sckools runs a school online on one login: a **website studio** (presets, per-section layouts, festival skins, own
domain), an **admissions desk**, **fees and receipts**, the **register**, **timetable**, **exams, results, report
cards and certificates**, **leave and cover**, **diary, notes, assignments, messages**, **announcements and the
reception TV**, a **library counter**, a **jobs board**, **alumni**, and the inter-school **Events Network** — with an
**admin console**, **teacher** and **student** portals on the web, and a **family/staff mobile app**. Plans: Basic
(website + admissions), Standard (+ events network, blog), Pro (+ the office, staff room, app, library, jobs),
priced per student per year. The platform owner runs schools, tiers, domains, leads and prices from
`owner.sckools.com`.

## Ten invariants (never bend)

1. Tenant is the host, never the payload (`X-Skoolos-Host` → hostname → Host).
2. Feature access = tier + per-school override, cached 300s.
3. A register belongs to its own day; only an approved change request reopens one.
4. A substitution is a one-day grant.
5. Teachers act only on their own classes; enforced server-side.
6. A student only ever reads their own row (`studentId` from the JWT).
7. Unpublished results do not exist to students.
8. Notifications are best-effort and post-commit.
9. Timetables are versioned, not edited.
10. Only a `LIVE` school serves a public site.

(Expanded, with the enforcing files, in the behaviour spec skill.)

## Non-negotiables of working here

`pnpm preflight` before every push · ship to `staging` first, PR to `main`, the user merges · production
migrations are a manual dispatch the user runs · never `git add -A` from the corrupted local checkout · log
every mistake to the ledger · `X-Skoolos-Host` on every tenant call and `enabled: !!host` on every admin query ·
RLS on every new tenant table · Sckools is the brand, skoolos the internal name.

## Stamp

See `references/inventory/STATE.json` (commit, branch, date). Latest entries: `references/changelog.md`.
