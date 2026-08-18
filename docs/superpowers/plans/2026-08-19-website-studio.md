# Website Studio — staging patch plan (2026-08-19)

Pitched and approved in the Design Studio artifact. This patch adds preview/drafts,
new design axes, festive themes, footer config, custom pages and a custom-code
escape hatch — WITHOUT removing or changing any existing option. Every default
emits no class; shipping repaints zero schools.

## Phases (commit each when green)

1. **DB**: `SchoolProfile` += `scrollFeel('CLASSIC')`, `navDropdownAnim('FADE')`,
   `heroMedia('IMAGE')`, `heroVideoUrl?`, `sectionVariants Json?`, `festiveTheme Json?`,
   `footerConfig Json?`, `customSectionCss Json?`, `customHtmlBlock?`.
   New models `DesignDraft` (name, config Json, publishAt?, revertAt?, appliedAt?,
   revertConfig Json?) and `SchoolPage` (slug frozen, title, blocks Json, published).
   Hand-written migration `20260819100000_website_studio` w/ RLS matching existing
   tenant tables. `pnpm db:generate` only — NEVER migrate staging DB from here.
2. **Pure vocab (web)**: `components/public/site-variants.ts` — SCROLL_FEELS,
   NAV_DROPDOWN_ANIMS, SECTION_VARIANTS (stats/about/courses/admissions/gallery/staff:
   layout + gesture override), FOOTER_LAYOUTS/COLORS, FESTIVALS (5, variants,
   LAYER|FULL, full palettes), HERO_MEDIA, class mappers (default → ''),
   `scopeSectionCss()` sanitizing scoper, PageBlock types + `validatePageBlocks`.
   Unit tests beside it. NO component imports (next/font trap).
3. **Renderer**: PS_CSS additions (all new classes token-based; motion-off +
   reduced-motion coverage — sk-motion-safety + section-shape-coverage gates);
   themeRootProps adds scrollFeel/festive-full classes; PublicSite applies
   sectionVariants + renders FooterSection (new, replaces inline footer),
   FestiveLayer (new), custom CSS `<style>` via scopeSectionCss, custom HTML
   section (server-sanitized), scroll-feel effects (deck/snap CSS, glide JS);
   SiteNav dropdown-anim class; navModel gains custom pages (`page:` keys →
   `/p/[slug]`); HeroSection VIDEO background; `app/p/[slug]/page.tsx`.
4. **API**: DTO fields (@IsIn allowlists mirroring vocab); site-content.service
   generalizes JSON-column split + sanitizes customHtmlBlock (sanitize-html) and
   customSectionCss; public-site.service projects new fields + published pages;
   new `design-drafts` + `school-pages` controllers/services under cms module.
5. **Studio tab**: new FIRST tab `Studio` in `/app/website` (all 12 existing tabs
   untouched). Left rail: drafts bar (status/publish/restore), scroll feel,
   dropdown anim, hero media+video, section variants, festive, footer, custom
   pages editor, custom code. Right: `/preview` iframe (same-origin) receiving
   `{type:'sk-preview', profile:…, footer:…, pages:…}` postMessage; `/preview`
   is a client page: fetches `/public/site` w/ location.host, merges, renders
   `<PublicSite/>`. RESPONSIVE: ≥lg two-column; <lg an Edit/Preview segmented
   toggle swaps rail↔iframe full-width; portal sidebar already has drawer.
6. **Scheduling = read-time overlay (no worker)**: trap #7 — no state
   transition depends on a scheduler. public-site.service finds a DesignDraft
   whose [publishAt, revertAt] window contains now() and overlays its config on
   the projected profile. Self-applying, self-reverting, zero mutations.
   Explicit "Publish now" copies draft config into SchoolProfile.
7. **Gates**: pnpm --filter web test + typecheck, api typecheck, db generate.
   Custom-code path proven by unit test feeding a full animation snippet
   (@keyframes + transform) through scopeSectionCss.

## Repo rules in force
- default value emits NO class (guard-tested).
- No backticks in PS_CSS comments. `.ps-panel` only below the fold (coverage test).
- Portal styling via var(--sk-*) tokens; no hardcoded brand hex (sk-theme guard).
- vitest does not typecheck — run both. Package scripts, not bare tools.
- navConfig-style Prisma JSON split for every new Json column.
- Never `git add -A`; never migrate/seed staging DB from a task.

## Status log (update as phases land — record the commit hash when each is DONE)
- [ ] P1 DB schema + migration + generate
- [ ] P2 site-variants + tests
- [ ] P3 renderer
- [ ] P4 API
- [ ] P5 studio tab + preview
- [ ] P6 worker
- [ ] P7 gates green
