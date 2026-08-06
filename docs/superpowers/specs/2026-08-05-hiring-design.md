# Hiring — design

Phase 6, step 6. The last step of the public-website phase, and the only one
that is purely additive: nothing else depends on it.

Status: **approved 2026-08-05**, not yet implemented.

---

## 1. What this is

Schools post vacancies. The owner approves them. They appear on a network jobs
board at `sckools.com/jobs`, where a stranger applies without an account. The
hiring school works its own applications.

**Hiring appears ONLY on sckools.com.** There is no careers page on a school's
own site and no nav slot for it — decided 2026-08-05, and it is what makes
owner approval load-bearing rather than ceremonial: every post lands on the
owner's own front door.

## 2. Decisions, and why

| Decision | Reasoning |
|---|---|
| **Network-wide, owner-approved** | The board is the only surface, and it is the owner's site. Mirrors NETWORK events exactly: `PENDING → APPROVED / REJECTED`. |
| **The CV is a LINK, not a file** | Every upload path in the product today is authenticated. A public endpoint accepting binaries from strangers is a different security problem — malware, quota abuse, retention — and would be the largest single risk in this step. A URL costs nothing to accept. Accepted downside: links expire or get set to private, and the school finds out when they click. |
| **Four question types: CHOICE, YES_NO, NUMBER, TEXT** | Covers what a school screens on with the fewest concepts. NUMBER exists because "years teaching ≥ 3" is the most useful filter on a teaching vacancy and a choice-list of invented buckets is a worse version of it. MULTI_SELECT deliberately deferred: its filter semantics (any-of vs all-of) are the easiest to get wrong. |
| **`posts` is an Int, not a boolean** | Schools hire in batches. "We need three" is the most useful fact on a listing. |
| **`posts` does NOT interact with applications** | No auto-close, no decrement. A vacancy for 3 that draws 40 applications stays open until the school closes it. Confirmed deliberate — flagged here because it otherwise reads as an oversight later. |
| **Feature-gated on `HIRING`** | Consistent with EVENTS/BLOG, and gives the owner a commercial lever over who may post. |
| **Applicants are strangers** | Requiring an account loses exactly the people the network does not already have. |
| **Four questions maximum** | The cost lands on the candidate; the benefit lands on the admin. Enforced in the service, not only in the builder UI. |
| **Every filterable question becomes a filter automatically** | A question that cannot become a filter is one somebody reads sixty times and acts on none of. TEXT is the sole non-filterable type and the builder says so plainly. |
| **One moderation queue** | Reuses the owner's existing pending-review pattern. A second queue is how one of them stops being read. |

## 3. Data model

Three tables, deliberately the shape of event registrations: a thing, an
application against it, and a status the host owns.

### `JobPost`

```
id            uuid
schoolId      uuid            -- the hiring school
title         text
summary       text            -- one line, shown on the board
description   text            -- the full posting
employmentType  FULL_TIME | PART_TIME | CONTRACT | TEMPORARY
subject       text?           -- "Physics", "Primary" — free text, a filter on the board
posts         int  default 1  -- NOT a boolean. How many people they need.
salaryMinMinor int?           -- minor units, never a float
salaryMaxMinor int?
currency      text default 'INR'
applyBy       timestamptz?
status        DRAFT | PENDING | APPROVED | REJECTED | CLOSED
rejectedReason text?          -- the owner owes a reason
createdByUserId uuid?
approvedByUserId uuid?
approvedAt    timestamptz?
createdAt / updatedAt
```

### `JobQuestion`

```
id          uuid
jobPostId   uuid
schoolId    uuid            -- carried for RLS, as EventTicketType does
prompt      text
kind        CHOICE | YES_NO | NUMBER | TEXT
options     text[]          -- CHOICE only
required    boolean default false
order       int
```

Maximum four per post, enforced in `JobsService`.

### `JobApplication`

```
id          uuid
jobPostId   uuid
schoolId    uuid            -- the HIRING school, derived from the vacancy
name        text
email       text
phone       text?
cvUrl       text            -- a link
answers     jsonb           -- { [questionId]: string | number | boolean }
status      NEW | SHORTLISTED | INTERVIEWING | REJECTED | HIRED
note        text?           -- the school's private note
createdAt
```

`answers` is JSON rather than a fourth table: with a hard cap of four questions
a join table buys nothing and makes the filter query worse.

## 4. Row level security

**This is the most sensitive data the product stores** — a private
individual's name, phone and CV link, submitted by somebody with no account,
and it belongs to the hiring school alone.

- `JobPost` — `tenant_iso`. The board and the owner queue read through the
  platform connection, so no network read policy is needed or wanted.
- `JobQuestion` — `tenant_iso`.
- `JobApplication` — **`tenant_iso` ONLY.** No network read policy, no owner
  read, no cross-school read, now or later. Keep it that way even when someone
  asks for network-wide candidate search.

### The write path, stated honestly

`sckools.com` resolves to the platform, not to a school, so an application
arrives with **no tenant context** and cannot be written through a school's
RLS connection. It is therefore written with the platform connection, and the
protection is:

- `schoolId` and `jobPostId` come from **the vacancy that was applied to**,
  never from the request body — a caller cannot file a candidate into a school
  it names;
- the vacancy must be `APPROVED`;
- the endpoint is `@Public` and throttled like the enquiry form.

The guard is the vacancy lookup rather than RLS. That is a real trade and it is
written down here so a later reader does not assume RLS is doing work it is
not. Reads stay fully tenant-scoped, which is where the cross-school rule
actually bites.

## 5. Surfaces

### Public — `sckools.com`

- `/jobs` — the board. Filters: school, employment type, subject. `/jobs`
  rather than `/careers`: it is what people search for, and "careers" is the
  word an employer uses about itself.
- `/jobs/[id]` — the vacancy and its apply form: name, email, phone, CV link,
  and up to four answers.

### Admin — a page, in the sidebar

- **`/app/jobs`**, listed in the left sidebar beside Website, Blog, Enquiries
  and Events. Inside it, two tabs:
  - **Vacancies** — list, editor, and the question builder (max four; TEXT is
    marked as unfilterable in the builder itself).
  - **Applications** — the desk. Every CHOICE question renders as a dropdown
    filter, every YES_NO as a toggle, every NUMBER as a minimum. Status and
    private note are editable here.

### Owner — a page, in the side nav

- **`/platform/jobs`**, beside Schools, Blog Queue and Connect. The `PENDING`
  queue with approve / reject-with-reason, reusing the network-event
  moderation pattern.

## 6. API

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/manage/jobs` | school admin | own vacancies |
| POST | `/manage/jobs` | school admin | creates DRAFT |
| PATCH | `/manage/jobs/:id` | school admin | editing an APPROVED post returns it to PENDING |
| POST | `/manage/jobs/:id/submit` | school admin | DRAFT → PENDING |
| POST | `/manage/jobs/:id/close` | school admin | → CLOSED |
| GET | `/manage/jobs/:id/applications` | school admin | the desk |
| PATCH | `/manage/jobs/applications/:id` | school admin | status + note |
| GET | `/owner/jobs?status=PENDING` | owner | moderation queue |
| PATCH | `/owner/jobs/:id` | owner | approve / reject with reason |
| GET | `/public/jobs` | public | APPROVED only, platform host |
| GET | `/public/jobs/:id` | public | |
| POST | `/public/jobs/:id/apply` | public, throttled | schoolId from the vacancy |

Editing an approved post re-enters moderation, for the same reason editing an
approved NETWORK event does: otherwise an admin can push arbitrary content live
on the owner's own site with no second look.

## 7. Testing

- **Pure, unit-tested:** question → filter mapping; the four-question cap;
  which kinds are filterable.
- **Service specs:** `schoolId` is taken from the vacancy and never from the
  body; applying to a non-APPROVED vacancy is refused; the status machine
  (DRAFT → PENDING → APPROVED/REJECTED → CLOSED); editing an approved post
  returns it to PENDING.
- **Web:** the board renders and filters; the apply form posts exactly the
  fields it collected; the desk's filters are generated from the questions
  rather than hardcoded.
- **Guard:** a test asserting `JobApplication` has no cross-school read policy
  in its migration — the constraint most likely to be "temporarily" relaxed.

## 8. Build order

1. Schema + migration, admin vacancy CRUD + question builder, owner moderation.
2. Public board + apply endpoint.
3. Applications desk with auto-generated filters.

Each slice deploys to staging on its own. Phase 6 stays on staging until it is
stable — these migrations do not go to prod with the others.

## 9. Not in this step

- File upload for CVs (deliberate — see §2).
- MULTI_SELECT questions.
- Any network-wide candidate search, ever.
- Emailing candidates. The desk holds the email; the school writes to them
  themselves. Nothing here sends mail, and no UI may claim it does.
