# Phase 6 — the public school website

Branch: `feat/phase6-website` (cut from `staging` at `06f3e9f`, kept current).

Everything here is **approved**. This document exists so the build can start
cold, without re-deriving any decision. Where a choice was contested, the
reasoning is recorded — not to be polite, but because the reasoning is what
tells you whether a later change is still safe.

---

## 0. The decided defaults

### Nav groups

Five top-level controls plus two actions. Ships as the default for every
school; the school may rename or rearrange (§3).

| Group | Behaviour | Contains |
|---|---|---|
| **Our school** | menu only | About · Hall of Fame · Gallery |
| **Academics** | is a page | the programme list (existing dropdown) |
| **Admissions** | flat, never grouped | — |
| **News & events** | menu only | Connect · Blog |
| **Contact** | flat | — |
| *Login · Enquire* | actions, right-aligned | — |

**"Home" is deleted.** The crest already links home; every site on the internet
has taught people that. Keeping both spends a slot on a thing nobody needs told
twice, and slots are the entire problem.

**"News & events", not "What's on".** "What's on" is warmer and four characters
shorter, and it was the pitch's wording. It loses on two counts: it is an idiom
that reads unclearly to non-native English speakers, which is a real share of
Indian school parents, and it is not what anybody searches for. Five controls
leaves room for the longer label.

**Admissions is never grouped.** It is the page a school most wants read and a
parent most often wants. Grouping exists to reduce noise, not to hide the thing
the site exists to do.

### The hard cap

**Six top-level controls.** Not taste — seven is where a school name of typical
length starts truncating at 1280px, which is the bug being fixed. The editor
warns at seven and says why.

---

## 1. Build order, and why

1. **Nav grouping** — default only, no config UI.
2. **`/connect`** + the public registration endpoint.
3. **The customisation increment** (section shape, motion character, texture).
4. **The remaining pages**, inheriting that system.
5. **Nav configuration UI** (drag & drop).
6. **Hiring.**

**3 before 4 is load-bearing.** Redesign the pages first and every one gets
built twice — once now, once when the token system lands.

**Nav grouping is first** because it is visible on every page of every school
site and is currently truncating school names.

**Hiring is last** despite being the largest, because it is the only piece that
is purely additive. Nothing depends on it, so it cannot block the rest, and it
wants a session of its own.

---

## 2. Nav grouping (step 1)

`apps/web/components/public/sections/SiteNav.tsx` — 560 lines, links hardcoded
in two places (desktop and mobile). **That duplication is the thing to fix
first**: grouping applied to one and not the other is how the mobile drawer
silently keeps the old eleven items.

- Extract a single `NAV_MODEL` the desktop bar and the mobile drawer both read.
- Groups are `button` + `aria-expanded`, opening on hover **and focus**. A menu
  a keyboard cannot reach is a menu a third of visitors do not have.
- On touch, the first tap opens the group; it never navigates. There is no
  hover on a phone, so a parent that only opens on hover is unreachable.
- Mobile drawer renders groups as expandable sections, not a flat list.

**Test the cap, not the layout.** Assert that the default model produces ≤6
top-level controls, and that every page in `SUBPAGES` is reachable from the
model — a page that exists but appears in no group is a page the school loses.

---

## 3. Nav configuration (step 5)

Per-group behaviour, because the right answer differs by group:

- `menu` — opens the list, navigates nowhere. Default. Correct when every child
  is already a real page.
- `page` — the parent IS one of its children; the others nest under it. The
  child list must then stop repeating the page you are on.
- `overview` — a generated page listing the children, using the existing card
  components. The only option that gives search engines somewhere to land.

**The label is editable; the slug is frozen at creation.** Renaming "Our school"
to "Discover us" must not break every shared link or drop a page from results it
already ranks for. Show the frozen slug in the editor so the consequence is
never a surprise.

The editor refuses: more than six top-level controls; an empty group (offered as
a flat page instead); a group inside a group (two levels is a school website,
three is a filing system); and losing a page — dragging one out of every group
makes it top-level, **never** invisible.

---

## 4. Events (step 2)

The registration engine shipped in Phase 5 — capacity, waitlist, confirmations,
the admin desk. It has **no front door**: the only routes in are authenticated
admin ones, so the desk is empty and nobody can sign up.

- Public `POST` registration endpoint, rate-limited, writing through
  `RegistrationsService` so capacity and the waitlist behave identically
  whichever door someone came through.
- `/connect`: Join button, school vs network as two named sections, seats beside
  the button, date as an object rather than a substring, "You're going" state,
  and a drawn empty state instead of a 48px emoji.
- The ambient layer: two blurred divs in `--ps1`/`--ps2`, header only, obeying
  the school's own `animationLevel` and `prefers-reduced-motion`.

---

## 5. The audit findings (step 4)

Measured against `apps/web/components/public/`, not asserted:

- **Programmes render as a 48px emoji** on a gradient wherever a school has not
  uploaded artwork — which is most of them. `AcademicsSection` and
  `CoursesFeatured`. Needs a real generated-mark placeholder from the school's
  palette and the programme's initial.
- **Contact has zero scroll reveals** while every other section has 1–4, so a
  page that has been animating all the way down simply stops.
- **Exactly one empty state exists in the whole site** ("No upcoming events
  right now"). Gallery, staff, courses, hall of fame and admissions render
  nothing, so a new school's site is a series of silent gaps with no hint to the
  admin that anything is missing.
- **The duplicate-heading bug is not only on `/academics`.** `GallerySection`,
  `EventsSection` and `ContactSection` each carry their own eyebrow and heading
  and are each rendered under a page masthead that already said it. Academics is
  fixed (`onOwnPage`); the other three are not, and each needs its own decision
  about what the masthead should say — they are not all as redundant as
  academics' was.
- **The blog is off-theme.** It renders outside the school's `--ps1`/`--ps2`
  scope, so it does not wear the school's identity. This is a theming-
  inheritance fix, not a layout one.

---

## 6. Hiring (step 6)

Three tables, deliberately the same shape as event registrations: a thing, an
application against it, and a status the host owns. Full data model and
reasoning in the pitch; the parts that must not be quietly changed:

- `posts` is an **Int**, not a boolean "is open". Schools hire in batches and
  "we need three" is the most useful fact on the listing.
- Applicants are **strangers** — no account. Requiring one loses exactly the
  people the network does not already have.
- **Every screening question becomes a filter** on the applications desk,
  automatically. A question that cannot become a filter is one somebody reads
  sixty times and acts on none of. Short text is the only non-filterable type
  and the builder says so.
- **Four questions maximum.** The cost lands on the candidate; the benefit lands
  on the admin.
- Approval reuses the **existing owner Requests desk**. A second moderation
  queue is how one of them stops being read.

**The one genuinely sensitive part:** applications hold a private individual's
name, phone and CV, submitted by someone with no account. It is the most
sensitive data this product will store and it belongs to the hiring school
alone. RLS is **single-tenant with no cross-school read** — simpler than event
registrations. Keep it that way even when someone asks for network-wide
candidate search.
