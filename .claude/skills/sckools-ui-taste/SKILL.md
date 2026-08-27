---
name: sckools-ui-taste
description: Use BEFORE writing or changing any user-facing UI in this repo — a new page, section, panel, button, form, tab row, or empty state. Encodes what Darshan has actually rejected and accepted, so the default output is a finished interface rather than a functional one that has to be sent back. Read it even when the request only says "add X" and says nothing about design.
---

# What good looks like here

Every rule below was paid for by a screenshot sent back with "this is so off
design" or "match our theme properly". None of it is taste in the abstract.

## The standing expectation

**A feature is not done when it works. It is done when it looks like the rest
of the product.** Darshan reviews by opening the page and looking at it. The
first feedback is always visual, and "it passes its tests" has never once been
an answer to it.

He has never asked for less design than was delivered. He has repeatedly asked
for more: *"improve these design properly"*, *"propelry match the best ui with
our current theme"*, *"ui should match our theme"*, *"pitch me working design
need to see real controls"*. When in doubt, the richer, more finished treatment
is the one he wanted.

"Keep it light" — which he does sometimes say — means **fewer features**, never
rougher execution. A light feature still gets the full visual standard.

## Before writing a single class

1. **Find the system.** Two live here and they never mix:
   - `.ps-*` (`components/public/ps-css.ts`) — anything a parent or alumnus
     sees. Wears the school's own colours through `--ps1` / `--ps2` / `--ink` /
     `--paper`.
   - `.sk-*` (`app/sk-theme.css`) — the staff console at `/app`.
   A public page built in `sk-` classes is the single most common way to get
   sent back. It happened with the alumni page.

2. **Find the nearest existing component and copy its recipe.** Not the
   theme's documented API — *the file's actual convention*. `app/app/alumni/
   page.tsx` tones pills with inline `style={{ background: 'var(--sk-good-tint)' }}`
   even though the theme also offers `data-tone`. Classes invented by analogy
   (`p-good`, `.sm`, `.primary`) do not exist and render as unstyled text.
   Grep for how the file already does it before adding a variant.

3. **Check whether the recipe should be a class.** If you are about to write
   the same six utilities a second time, put it in the stylesheet instead. The
   whole `.ps-cta` / `.ps-seg` family exists because "Enquire now" was
   hand-rolled at one call site, so every later button was rebuilt by eye and
   came out lighter.

## The specific failures, so they are not repeated

**A button with no padding.** `.ps-btn` sets a radius and a shadow and nothing
else. `className="ps-btn ps-cta-btn"` renders a cramped little pill next to a
confident one. A button of consequence is `.ps-cta` plus a fill — never a bare
`.ps-btn`, never a pile of utilities.

**Two saturated buttons side by side.** If a primary action in `--ps1` is
already on screen, a second one in `--ps1` reads as one smear. The second gets
`.ps-cta-ink`. Contrast is `--ink`, not `--ps2`: the accent is school-chosen
and may be a pale marigold that cannot carry white text.

**Same-hue tint under same-hue text.** A chip tinted 12% of the brand hue with
text of that same hue has almost no chroma separation — it reads as a smudge.
Put the tint on the *track* and the ink on the *label*. That is what `.ps-seg`
does.

**`opacity` as a disabled state.** Fading a saturated fill toward cream makes a
muddy lavender that white text disappears into — at exactly the moment the
label says something ("Sending…"). Give disabled its own flat neutral fill and
a dark label.

**`text-slate-400` on `--paper`.** About 2.4:1. Below AA. `text-slate-500` is
the floor for anything a person has to read on cream.

**Hardcoded corners below the fold.** Schools pick one of seven section shapes;
Editorial is square and shadowless. A `rounded-full` or `rounded-xl` written by
hand is a place that control cannot reach, and it reads as a bug rather than a
choice. Use `var(--ps-radius)` / `var(--ps-radius-sm)`, and add the file to
`section-shape-coverage.test.ts` so it cannot drift back.

**State in two places.** Do not set the selected style with an inline `style={}`
next to `aria-pressed`. Drive it from `[aria-pressed="true"]` in CSS so the
state and the look cannot disagree.

## Empty, loading, locked and error states are part of the design

A tab an alumnus cannot open yet still has to be *readable* — it is the thing
telling them what signing in is for. `opacity: .45` made it a rumour of a tab.
Every state gets a real treatment: an empty list says what would be there, an
error says what to do next, a locked control says why.

## Before saying it is done

- **Render it and look at it.** Not the test output — the pixels. Extract
  `PS_CSS`, drop the real markup into a static page, serve it, screenshot it.
  Both the fixed state and the before, so the difference is visible. The
  disabled-button and stray-glyph defects in this file were both found by
  looking, after the tests were green.
- **Look at it narrow.** ~360px. Selectors wrap, CTAs stack.
- **Check the states**: hover, disabled, selected, empty, error.
- **Run `vitest run components/public`** (or the `sk-theme` guards for the
  console) — they encode decisions made earlier and will catch a regression
  you did not know was one.

## When something genuinely needs a new pattern

Add it to the stylesheet with a comment saying *what went wrong without it*,
give it a guard test in `section-shape-coverage.test.ts`, and prove the guard
bites by deleting the rule and watching exactly that test go red. A guard
nobody has watched fail is not evidence — that is a house rule here, and it
applies to CSS as much as to authorization.
