# Screen audit — measured, not eyeballed

Renders the **real** components to static HTML, then measures them in a real
browser at 390 / 414 / 768 / 1024 / 1280.

Two renderers, because the screens differ in kind:

- `render.test.tsx` / `portal.test.tsx` — the sports desk and the portals.
  Those components take props, so `renderToStaticMarkup` is enough.
- `pay.test.tsx` — the Pay module. Those tabs are hook-driven, so a static
  render would only ever capture their loading state and the audit would
  measure three spinners. It mounts them with resolved query data and
  serialises the settled DOM, and asserts on a value that only appears once
  the data has arrived so a silent regression to the loading state fails.

Hand-written harness markup was the weak link in every earlier responsiveness
pass: it can drift from what the app actually emits, so a clean result proved
nothing. This renders the components themselves.

```bash
pnpm --filter @skoolos/web audit:screens   # writes audit/screens.html
cd apps/web/audit && python3 -m http.server 8797
# open http://localhost:8797/measure.html — it prints findings per width
# ?file=./pay.html or ?file=./screens-portal.html for the other sets
```

It reports three classes of defect, each mechanical:

- **OVERFLOW** — an element past the viewport that is *not* inside a horizontal
  scroller. A timetable wider than the phone is fine; a page that scrolls
  sideways is not.
- **CLIPPED** — a leaf whose content is wider than its box, with no scroller and
  no ellipsis. That is text nobody can read.
- **TAP** — an interactive element under 24px on a touch width.
- **RAGGED** — two rows of one list whose cells start at different x. A flex
  row with a `flex: 1` spacer lets each row's text decide where its controls
  land, so no two rows agree. Use `RowList`/`Row`/`Cell` from
  `components/ui/kit.tsx`: the LIST declares the tracks, every row inherits
  them, and the spread is measured here at 0px.
- **DIALOG NO BACKGROUND / DIALOG INSIDE MAIN** — an overlay outside the theme
  (tokens live on `.skosx`; a portal on bare `<body>` resolves them to nothing)
  or one rendered inside `<main>`, where `.sk-anim`'s transform will re-anchor
  its `position: fixed`. Both shipped once.

Motion is switched off inside the measured frame. Chrome does not tick
animations in an off-screen iframe, so an entrance animation sits frozen on its
first frame and a drawer measures as entirely off-screen — a frame nobody sees.
The harness measures the resting layout, exactly as reduced-motion renders it.

`screens.html` is generated and git-ignored. Fixtures deliberately use the
longest realistic values (a full Indian name, `4 × 100 m relay`), per the
`ui-mistake-ledger` rule about testing with short values.
