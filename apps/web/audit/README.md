# Screen audit — measured, not eyeballed

Renders the **real** sports components to static HTML, then measures them in a
real browser at 390 / 414 / 768 / 1024 / 1280.

Hand-written harness markup was the weak link in every earlier responsiveness
pass: it can drift from what the app actually emits, so a clean result proved
nothing. This renders the components themselves.

```bash
pnpm --filter @skoolos/web audit:screens   # writes audit/screens.html
cd apps/web/audit && python3 -m http.server 8797
# open http://localhost:8797/measure.html — it prints findings per width
```

It reports three classes of defect, each mechanical:

- **OVERFLOW** — an element past the viewport that is *not* inside a horizontal
  scroller. A timetable wider than the phone is fine; a page that scrolls
  sideways is not.
- **CLIPPED** — a leaf whose content is wider than its box, with no scroller and
  no ellipsis. That is text nobody can read.
- **TAP** — an interactive element under 24px on a touch width.

`screens.html` is generated and git-ignored. Fixtures deliberately use the
longest realistic values (a full Indian name, `4 × 100 m relay`), per the
`ui-mistake-ledger` rule about testing with short values.
