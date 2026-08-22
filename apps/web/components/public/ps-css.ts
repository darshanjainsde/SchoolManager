/**
 * The public site's entire stylesheet, themed per school through CSS variables
 * set on the root element by `themeRootProps`.
 *
 * It lives in its own module so that every surface wearing a school's identity
 * — the site itself and the school's blog — injects the SAME stylesheet rather
 * than a copy that can drift. The CSS guard tests read this file directly.
 *
 * NOTE: this is a template literal. Never use backticks inside its comments —
 * one closes the string and the compiler reads the rest of the CSS as JS.
 */
export const PS_CSS = `
  /* color-scheme: a school site is single-theme light by design, and without
     this the BROWSER paints every unstyled form control (inputs, selects,
     number spinners, date pickers, scrollbars) in the visitor's OS dark theme
     — near-black boxes in the middle of a cream page. */
  .ps-root { font-family: 'Inter', sans-serif; background: var(--paper); color: #43514a; overflow-x: hidden; min-height: 100vh; color-scheme: light; }
  .ps-head { font-family: var(--font-head); color: var(--ink); letter-spacing: -.01em; }
  /* This stylesheet loads after Tailwind, so .ps-head's ink color silently beat
     Tailwind's .text-white on dark sections (invisible headings/names on the
     Hall of Fame & Events). Re-assert white when both classes are present. */
  .ps-head.text-white { color: #fff; }

  .ps-soft { box-shadow: 0 22px 48px -24px rgba(28,45,36,.38); }
  .ps-card { background: #fff; border: 1px solid rgba(28,45,36,.07); }
  .ps-chip { background: color-mix(in srgb, var(--ps1) 12%, #fff); color: var(--ps1); }
  .ps-brandbg { background: var(--ps1); }
  .ps-accentbg { background: var(--ps2); }
  .ps-brandgrad { background: linear-gradient(120deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2))); }
  .ps-logo-bg { background: linear-gradient(135deg, var(--ps1), var(--ps2)); }
  .ps-cta-btn { background: var(--ps1); color: #fff; }
  .ps-icon-bg { background: linear-gradient(135deg, var(--ps2), var(--ps1)); }
  .ps-progress-bar { background: linear-gradient(90deg, var(--ps1), var(--ps2)); height: 100%; }

  /* gradient/underline accents */
  .ps-grad-text { background: linear-gradient(100deg,var(--ps1),color-mix(in srgb, var(--ps1) 40%, var(--ps2))); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ps-about-glow { background: linear-gradient(135deg, color-mix(in srgb, var(--ps1) 20%, transparent), color-mix(in srgb, var(--ps2) 20%, transparent)); filter: blur(2rem); }

  /* ── School-themed motion, all scaled by --motion (0..1) ── */
  @keyframes ps-floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(calc(-12px * var(--motion)))} }
  .ps-float { animation: ps-floaty calc(7s / (var(--motion) + .06)) ease-in-out infinite; }
  .ps-d1 { animation-delay: -2.5s; }
  .ps-d2 { animation-delay: -4.5s; }
  @keyframes ps-sway { 0%,100%{transform:rotate(calc(-3deg * var(--motion)))} 50%{transform:rotate(calc(3deg * var(--motion)))} }
  .ps-sway { animation: ps-sway calc(5s / (var(--motion) + .06)) ease-in-out infinite; transform-origin: top center; }
  @keyframes ps-twinkle { 0%,100%{opacity: calc(1 - .65 * var(--motion))} 50%{opacity:1} }
  .ps-twinkle { animation: ps-twinkle calc(3.2s / (var(--motion) + .06)) ease-in-out infinite; }
  @keyframes ps-shine { to { background-position: 200% center; } }


  /* ── SUBPAGE MASTHEAD ────────────────────────────────────────────────────
     An editorial split, not a stack. The headline takes the measure it needs
     and the standfirst sits beside it in its own column, separated by a rule
     that draws itself in — so the masthead reads as one object arriving,
     rather than three left-aligned blocks landing in sequence.

     Derived entirely from --ps1/--ps2, so it wears whatever the school chose. */
  .ps-masthead { max-width: 72rem; }
  .ps-masthead-eyebrow {
    font-size: 12.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
  }
  .ps-masthead-split {
    display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 12px 44px; align-items: end; margin-top: 14px; position: relative; padding-bottom: 26px;
  }
  .ps-masthead-title {
    font-size: clamp(2.1rem, 5.2vw, 3.6rem); font-weight: 700; line-height: 1.02;
    letter-spacing: -.03em; margin: 0; text-wrap: balance;
  }
  .ps-masthead-lede {
    margin: 0 0 .35rem; color: var(--ink-3, #64748b); font-size: 1.02rem; line-height: 1.6;
    /* Hangs off the accent, which ties the standfirst to the school's colour
       without tinting the words themselves. */
    border-left: 2px solid var(--ps2); padding-left: 16px;
  }
  /* The rule under the whole masthead draws from the left on entry. */
  .ps-masthead-split::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: linear-gradient(90deg, var(--ps1), color-mix(in srgb, var(--ps1) 12%, transparent));
    transform: scaleX(0); transform-origin: left;
    transition: transform .9s cubic-bezier(.2,.7,.2,1) .12s;
  }
  .reveal.in .ps-masthead-split::after, .ps-masthead.in .ps-masthead-split::after { transform: scaleX(1); }
  @media (max-width: 760px) {
    .ps-masthead-split { grid-template-columns: 1fr; align-items: start; gap: 16px; }
    .ps-masthead-lede { border-left-width: 2px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ps-masthead-split::after { transition: none; transform: scaleX(1); }
  }
  /* reveal on scroll */
  .reveal { opacity: 0; transform: translateY(calc(26px * var(--motion) + 4px)); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .reveal.in { opacity: 1; transform: none; }
  /* No JavaScript (or a crawler): the reveal sweep never runs, so nothing would
     ever get .in. Content must never depend on JS to be VISIBLE — show it all. */
  @media (scripting: none) {
    .reveal { opacity: 1 !important; transform: none !important; clip-path: none !important; }
  }

  /* hand-drawn underline draws itself once */
  @keyframes ps-draw { to { stroke-dashoffset: 0; } }
  .ps-underline path { stroke-dasharray: 300; stroke-dashoffset: 300; animation: ps-draw 1.5s ease .35s forwards; }

  /* gentle lift on hover */
  .ps-lift { transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
  /* The lift's shadow is a TOKEN, not a constant. Hardcoded, it grew a floating
     white panel on hover on an Editorial card — which has no fill and no shadow
     by definition — so the one control that is meant to reach everything below
     the fold visibly did not reach hover. */
  .ps-lift:hover { transform: translateY(-6px); box-shadow: var(--ps-lift-shadow); }
  .ps-root { --ps-lift-shadow: 0 30px 60px -28px rgba(28,45,36,.45); }
  .ps-shape-editorial { --ps-lift-shadow: none; }
  .ps-shape-crisp { --ps-lift-shadow: none; }

  /* glow button */
  .btn-glow { position: relative; overflow: hidden; }
  .btn-glow::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120px circle at var(--x,50%) var(--y,50%),rgba(255,255,255,.28),transparent 60%); opacity: 0; transition: opacity .3s; }
  .btn-glow:hover::after { opacity: 1; }

  /* ── Motion gesture ──────────────────────────────────────────────────────
     WHAT a section does as it arrives. animationLevel remains the volume: at
     NONE, .ps-motion-off silences all three of these. RISE is the base .reveal
     rule above, so it needs nothing here. */
  .ps-gesture-fade .reveal { transform: none; }
  .ps-gesture-fade .reveal.in { transform: none; }
  /* DRAW uncovers the section left to right, the way the headline motif draws
     itself — the same gesture at section scale, not a second idea.
     The static edges sit at -3rem (not 0): an inset(0) end-state clips the
     element to its border box FOREVER, amputating anything that overhangs it —
     the principal signature card, glows, soft shadows. Negative insets keep
     the wipe while leaving overhangs untouched. */
  .ps-gesture-draw .reveal { opacity: 1; transform: none;
    clip-path: inset(-3rem 100% -3rem -3rem);
    transition: clip-path .85s cubic-bezier(.2,.7,.2,1); }
  .ps-gesture-draw .reveal.in { clip-path: inset(-3rem); }
  .ps-motion-off .ps-gesture-draw .reveal, .ps-gesture-draw.ps-motion-off .reveal {
    clip-path: none; transition: none; }
  /* SLIDE: sections enter from the side (distance scales with the volume knob). */
  .ps-gesture-slide .reveal { transform: translateX(calc(-44px * var(--motion) - 6px)); }
  .ps-gesture-slide .reveal.in { transform: none; }
  /* ZOOM: sections scale up into place. */
  .ps-gesture-zoom .reveal { transform: scale(calc(1 - 0.12 * var(--motion))); }
  .ps-gesture-zoom .reveal.in { transform: none; }
  /* CURTAIN: uncovers top to bottom (static edges at -3rem — see DRAW). */
  .ps-gesture-curtain .reveal { opacity: 1; transform: none;
    clip-path: inset(-3rem -3rem 100% -3rem);
    transition: clip-path .8s cubic-bezier(.4,0,.1,1); }
  .ps-gesture-curtain .reveal.in { clip-path: inset(-3rem); }
  /* FLIP: tips up on a 3D hinge (travel scales with the volume knob). */
  .ps-gesture-flip .reveal { opacity: 0; transform-origin: top center;
    transform: perspective(900px) rotateX(calc(-18deg * var(--motion)));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-gesture-flip .reveal.in { opacity: 1; transform: none; }
  /* Animation=Off snaps them all to their resting state (RISE already does via --motion 0). */
  .ps-motion-off .ps-gesture-slide .reveal, .ps-motion-off .ps-gesture-zoom .reveal,
  .ps-motion-off .ps-gesture-flip .reveal {
    transform: none; transition: none; }
  .ps-motion-off .ps-gesture-curtain .reveal { clip-path: none; transition: none; }

  /* ── Background texture ──────────────────────────────────────────────────
     Drawn from the school's own --ps1 at low alpha, so a texture can never
     fight the palette. Fixed attachment would judder on iOS; these scroll. */
  .ps-texture-grid { background-image:
      linear-gradient(color-mix(in srgb, var(--ps1) 7%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--ps1) 7%, transparent) 1px, transparent 1px);
    background-size: 28px 28px; }
  .ps-texture-dots { background-image:
      radial-gradient(color-mix(in srgb, var(--ps1) 12%, transparent) 1px, transparent 1px);
    background-size: 20px 20px; }
  /* ONE wash across the page, never a tile. At background-size 900px these
     gradients repeated, and because they are not seamless at the edges the
     repeat showed as a hard vertical seam down the middle of every page. */
  .ps-texture-paper { background-image:
      radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--ps1) 6%, transparent), transparent 45%),
      radial-gradient(circle at 78% 60%, color-mix(in srgb, var(--ps2) 6%, transparent), transparent 40%),
      radial-gradient(circle at 45% 88%, color-mix(in srgb, var(--ps1) 5%, transparent), transparent 42%);
    background-repeat: no-repeat; background-size: 100% 100%; background-attachment: scroll; }

  /* ── The headline motif, off the headline ────────────────────────────────
     A band heading wears the SAME motif the hero headline does, so the page
     reads as one page. Driven by the school's existing headlineAccent — there
     is deliberately no second control that could disagree with the first. */
  .ps-accent-mark { position: relative; display: inline-block; }
  .ps-accent-draw .ps-accent-mark::after { content: ""; position: absolute; left: 0; right: 0; bottom: -6px;
    height: 3px; border-radius: 3px; background: var(--ps2);
    transform: scaleX(0); transform-origin: left;
    transition: transform .8s cubic-bezier(.2,.7,.2,1) .1s; }
  .reveal.in .ps-accent-mark::after, .ps-accent-mark.in::after { transform: scaleX(1); }
  .ps-accent-marker .ps-accent-mark { background: linear-gradient(to top,
      color-mix(in srgb, var(--ps2) 38%, transparent) 38%, transparent 38%);
    padding: 0 .12em; }
  .ps-accent-grow-on .ps-accent-mark::after { content: ""; position: absolute; left: 0; bottom: -8px;
    width: 3.5rem; height: 5px; border-radius: 4px; background: var(--ps2);
    transform: scaleX(0); transform-origin: left;
    transition: transform .6s cubic-bezier(.2,.7,.2,1) .1s; }
  .ps-motion-off .ps-accent-mark::after { transition: none; transform: scaleX(1); }

  /* ── Section shape ──────────────────────────────────────────────────────
     One control for every band BELOW the fold. The base values here are SOFT,
     which is what every school already renders, so the control's arrival
     changes nothing until somebody picks another shape.

     .ps-panel is the only thing a band below the fold may draw itself with —
     a hardcoded radius or shadow down there is a place the shape cannot reach,
     which is the bug this control exists to fix. */
  .ps-root { --ps-radius: 24px; --ps-radius-sm: 14px;
    --ps-card-bg: #fff;
    --ps-card-border: 1px solid rgba(28,45,36,.06);
    --ps-card-shadow: 0 18px 40px -28px rgba(28,45,36,.45);
    --ps-card-pad: 1.25rem;
    --ps-band-pad: 5rem; }
  /* NOT .ps-card — that one already means "white with a hairline" and is worn
     by the hero's floating cards, which sit ABOVE the fold and must keep their
     shape whatever a school picks below it. */
  .ps-panel { background: var(--ps-card-bg); border-radius: var(--ps-radius);
    border: var(--ps-card-border); box-shadow: var(--ps-card-shadow); }
  .ps-panel-sm { border-radius: var(--ps-radius-sm); }
  /* For a band that is already dark (the events band's brand gradient): the
     SHAPE still applies, but a white fill on a coloured band would be a hole
     in it. Declared after .ps-panel so it wins the background. */
  /* A button is chrome, not a panel, but it still carries the school's shape:
     a Crisp school asked for no soft shadows anywhere, and getting them on
     every button is exactly the "one control that doesn't reach" bug. */
  .ps-btn { border-radius: var(--ps-radius-sm); box-shadow: var(--ps-card-shadow); }
  .ps-shape-editorial .ps-btn { box-shadow: none; }
  .ps-shape-crisp .ps-btn { box-shadow: none; }

  .ps-panel-glass { background: rgba(255,255,255,.10);
    border: 1px solid rgba(255,255,255,.15); box-shadow: none; }
  .ps-shape-editorial .ps-panel-glass { border: 0; border-top: 2px solid rgba(255,255,255,.5); }
  .ps-band { padding-top: var(--ps-band-pad); padding-bottom: var(--ps-band-pad); }

  /* EDITORIAL: the card stops being an object. No fill, no shadow, no corner —
     a hairline rule above each entry, so a grid reads as ruled columns in a
     prospectus rather than as a tray of tiles. */
  .ps-shape-editorial { --ps-radius: 0px; --ps-radius-sm: 0px;
    --ps-card-bg: transparent;
    --ps-card-border: 0;
    --ps-card-shadow: none;
    --ps-card-pad: 0rem;
    --ps-band-pad: 5.5rem; }
  .ps-shape-editorial .ps-panel { border-top: 2px solid var(--ps1); padding-top: 1rem; }

  /* CRISP: the card is drawn, not floated. A real border carries the edge, so
     the shadow is not needed to say where the panel ends. */
  .ps-shape-crisp { --ps-radius: 6px; --ps-radius-sm: 4px;
    --ps-card-bg: #fff;
    --ps-card-border: 1px solid rgba(28,45,36,.16);
    --ps-card-shadow: none;
    --ps-card-pad: 1rem;
    --ps-band-pad: 4rem; }

  /* PANELS: the SECTION becomes the card. Every content band (not the hero,
     not the footer/nav) lifts onto a paper panel with big rounded corners and
     a soft shadow, floating on a lightly tinted page ground — so the whole
     page reshapes, not just the tiles inside it. Inner cards keep the Soft
     tokens. border-radius clips each band's own background to the rounded
     corner; content keeps overflowing freely (no clip), so an overlapping
     badge or a hover-lift is never cut. A band that carries its own colour
     (events, hall of fame) simply becomes a coloured panel. */
  /* Ground is a WARM tonal darkening of the paper so it tones with the cream
     panels instead of reading as a separate cool-grey colour (a cool tint next
     to warm paper looked like a mismatch at the notch/gaps). Kept subtle — just
     enough to let the panels and their shaped edges read. */
  .ps-shape-panels { background: color-mix(in srgb, #4a4130 4%, var(--paper)); }
  .ps-shape-panels > section,
  .ps-shape-panels > div[data-sec]:not([data-sec="hero"]) {
    border-radius: 22px;
    /* Centre every panel at a consistent width. A bare side-margin left the
       max-w-6xl bands (which centre via mx-auto) stuck to the left with a gap
       on the right; margin-inline:auto + a shared max-width fixes that and makes
       every panel the same size on the tinted ground. */
    max-width: min(76rem, calc(100% - clamp(20px, 5vw, 48px)));
    margin: 16px auto 0;
    box-shadow: 0 8px 26px -20px rgba(17,20,28,.25);
  }
  /* Paper fill ONLY for bands that don't bring their own colour. A white-text
     band (events, hall of fame) keeps its own dark/brand background — forcing
     paper onto it put white text on a white panel, i.e. an invisible band. */
  .ps-shape-panels > section:not(.text-white),
  .ps-shape-panels > div[data-sec]:not([data-sec="hero"]) {
    background: var(--paper);
  }
  .ps-shape-panels > section:last-of-type,
  .ps-shape-panels > div[data-sec]:not([data-sec="hero"]):last-of-type { margin-bottom: 18px; }

  /* Panel EDGES: shape only the TOP ~24px of each panel — which sits inside the
     band's top padding — so the tinted ground shows through an angled, notched
     or wavy cut and no content is ever clipped. clip-path supersedes the panel
     radius/shadow, so these read as shaped section dividers rather than cards. */
  .ps-edge-slant > section, .ps-edge-slant > div[data-sec]:not([data-sec="hero"]) {
    clip-path: polygon(0 26px, 100% 0, 100% 100%, 0 100%); }
  .ps-edge-notch > section, .ps-edge-notch > div[data-sec]:not([data-sec="hero"]) {
    clip-path: polygon(0 0, 44% 0, 50% 22px, 56% 0, 100% 0, 100% 100%, 0 100%); }
  .ps-edge-wave > section, .ps-edge-wave > div[data-sec]:not([data-sec="hero"]) {
    clip-path: polygon(0 12px, 10% 5px, 20% 13px, 30% 20px, 40% 13px, 50% 5px, 60% 13px,
      70% 20px, 80% 13px, 90% 5px, 100% 12px, 100% 100%, 0 100%); }
  /* Panels already frame every band, so when it's combined with the Deck scroll
     feel drop Deck's heavy top-shadow — two shadow systems on one band muddied
     the panel edges. */
  .ps-shape-panels.ps-scroll-deck > section,
  .ps-shape-panels.ps-scroll-deck > div[data-sec],
  .ps-shape-panels.ps-scroll-deck > footer { box-shadow: none; }

  /* Panels tints the whole page ground, which then shows through anything that
     sits on it with no fill of its own — including the hero and the transparent
     strip behind a floating nav. That left a faint darker band at the very top,
     behind the navbar. Give the top region paper so the page starts clean.

     1) The hero floats on paper (not the tinted ground) — this alone covers a
        floating nav that overlays the hero (fixed): behind it is the hero.
     2) A NON-overlay pill (sticky, no hero behind it) shows paper AT REST via its
        marker. On scroll it drops back to transparent (:not) so page content
        still passes behind its sides as intended.
     3) DECK forces every floating nav to position:sticky (see .ps-scroll-deck >
        #ps-nav below), so an OVERLAY pill/ghost is no longer over the hero — it
        takes flow space and its transparent shell reveals the ground strip. Under
        deck, paper that strip too (at rest; the hero sits below it, so nothing is
        covered). Scoped to deck because that's the only feel that relocates it. */
  .ps-shape-panels > [data-sec="hero"] { background: var(--paper); }
  /* The paper backdrop FADES into the tinted ground rather than stopping at
     the header's bottom edge — a solid rectangle drew a visible seam where
     paper met the ground strip above the first panel. */
  .ps-shape-panels #ps-nav.ps-nav-pill-flow:not(.ps-nav-scrolled),
  .ps-shape-panels.ps-scroll-deck #ps-nav.ps-nav-float-over:not(.ps-nav-scrolled) {
    background: linear-gradient(to bottom, var(--paper) 58%, transparent); }

  /* ── Ambient header layer (/connect) ──
     Two blurred brand-coloured drifts. No canvas and no library: two divs and
     one keyframe, scaled by the school's own --motion so a NONE school gets a
     still background rather than a slower one. */
  .ps-amb { position: absolute; border-radius: 9999px; filter: blur(60px); opacity: .28; }
  .ps-amb-1 { width: 42vw; height: 42vw; max-width: 520px; max-height: 520px; top: -14%; left: -6%;
    background: var(--ps1); animation: ps-amb-a calc(21s / (var(--motion) + .06)) ease-in-out infinite; }
  .ps-amb-2 { width: 34vw; height: 34vw; max-width: 420px; max-height: 420px; top: -6%; right: -4%;
    background: var(--ps2); animation: ps-amb-b calc(18s / (var(--motion) + .06)) ease-in-out infinite; }
  @keyframes ps-amb-a { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(4%, 6%, 0); } }
  @keyframes ps-amb-b { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(-5%, 4%, 0); } }
  .ps-motion-off .ps-amb { animation: none; }

  /* ── Nav group menus ──
     The menu is mounted only while open (it is a real button + aria-expanded,
     not a :hover rule), so this styles the open state and animates the entrance
     rather than toggling visibility. */
  .ps-menu-wrap { position: relative; }
  @keyframes ps-menu-in { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes ps-menu-row-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  /* The OUTER element is the pointer bridge: it starts flush against the tab
     and its padding-top is what holds the visible card 10px clear. A pointer
     travelling from the tab to a row therefore never leaves the menu, which is
     what stops the panel closing under the cursor. */
  .ps-menu { position: absolute; top: 100%; left: 0; padding-top: 10px; z-index: 60; }
  .ps-menu-card { width: 340px; max-width: 92vw; background: #fff;
    border: 1px solid rgba(28,45,36,.10); border-radius: 18px; padding: 8px;
    box-shadow: 0 24px 50px -26px rgba(28,45,36,.42), 0 2px 6px -2px rgba(28,45,36,.12);
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px;
    transform-origin: top left;
    animation: ps-menu-in .18s cubic-bezier(.2,.7,.2,1) both; }
  /* caret anchoring the card to its own tab so it reads as belonging to it */
  .ps-menu-card::before { content: ""; position: absolute; top: 4px; left: 24px; width: 13px; height: 13px;
    background: #fff; border-left: 1px solid rgba(28,45,36,.10); border-top: 1px solid rgba(28,45,36,.10);
    border-radius: 3px 0 0 0; transform: rotate(45deg); }

  .ps-menu-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px;
    border-radius: 12px; text-decoration: none; position: relative;
    transition: background .18s ease, transform .18s cubic-bezier(.2,.7,.2,1);
    animation: ps-menu-row-in .22s cubic-bezier(.2,.7,.2,1) both;
    animation-delay: calc(var(--i, 0) * 28ms + 30ms); }
  .ps-menu-row:hover, .ps-menu-row:focus-visible { background: color-mix(in srgb, var(--ps1) 8%, #fff); }
  /* The row slides a touch toward its destination — the same direction the
     arrow points, so the motion says "this goes somewhere" rather than "look
     at me". */
  .ps-menu-row:hover { transform: translateX(2px); }
  .ps-menu-row-label { display: block; font-size: 13px; font-weight: 700; color: var(--ink); }
  .ps-menu-row-hint { display: block; font-size: 11px; color: #94a3b8; }
  .ps-menu-row-arrow { margin-left: auto; font-size: 13px; color: var(--ps1);
    opacity: 0; transform: translateX(-4px);
    transition: opacity .18s ease, transform .18s cubic-bezier(.2,.7,.2,1); }
  .ps-menu-row:hover .ps-menu-row-arrow, .ps-menu-row:focus-visible .ps-menu-row-arrow {
    opacity: 1; transform: none; }

  /* Motion is the school's decision and the visitor's: both escapes drop the
     choreography to a plain appearance, never to a broken half-state. */
  .ps-motion-off .ps-menu-card, .ps-motion-off .ps-menu-row { animation: none; }
  .ps-motion-off .ps-menu-row, .ps-motion-off .ps-menu-row-arrow { transition: none; }

  /* Drawer variant: rows expand in place, indented under the group they belong to. */
  .ps-submenu { display: grid; gap: 2px; padding: 2px 0 6px 14px; margin-left: 10px;
    border-left: 2px solid rgba(28,45,36,.10); }

  /* ── Course flip cards ── */
  .ps-flip { perspective: 1200px; height: 340px; cursor: pointer; outline-offset: 4px; }
  .ps-flip-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
    transition: transform .65s cubic-bezier(.2,.7,.2,1); }
  .ps-flipped .ps-flip-inner { transform: rotateY(180deg); }
  .ps-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: 1.5rem; overflow: hidden; display: flex; flex-direction: column; }
  .ps-face-back { transform: rotateY(180deg);
    background: linear-gradient(150deg, var(--ps1), color-mix(in srgb, var(--ps1) 45%, #14261d)); }

  /* ── Headline accent variants (admin-selectable) ── */
  @keyframes ps-marker-sweep { to { background-size: 100% .38em; } }
  .ps-marker { background-image: linear-gradient(0deg, color-mix(in srgb, var(--ps2) 50%, transparent), color-mix(in srgb, var(--ps2) 50%, transparent));
    background-repeat: no-repeat; background-size: 0% .38em; background-position: 0 90%;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    animation: ps-marker-sweep .9s cubic-bezier(.2,.7,.2,1) .4s forwards; }
  @keyframes ps-accent-grow { to { transform: scaleX(1); } }
  .ps-accent-grow { display: block; margin-top: 14px; height: 6px; width: 8rem; border-radius: 999px;
    background: linear-gradient(90deg, var(--ps2), color-mix(in srgb, var(--ps2) 55%, var(--ps1)));
    transform: scaleX(0); transform-origin: left;
    animation: ps-accent-grow .8s cubic-bezier(.2,.7,.2,1) .35s forwards; }
  .ps-accent-grow.mx-auto { transform-origin: center; }

  /* ── Hero photo tiles + slideshow ── */
  .ps-tile { background-size: cover; background-position: center; }
  .ps-slide { position: absolute; inset: 0; background-size: cover; background-position: center;
    opacity: 0; transition: opacity 1.1s ease; }
  .ps-slide.on { opacity: 1; }
  @keyframes ps-kb { from { transform: scale(1); } to { transform: scale(calc(1 + 0.07 * var(--motion))); } }
  .ps-kb { animation: ps-kb 7.5s ease-out forwards; }

  /* ── Navbar variants ── */
  /* Links never break mid-label ("Hall of Fame" stays one line). */
  .ps-nav-link { white-space: nowrap; }
  .ps-nav-strip { background: var(--ink); color: rgba(255,255,255,.85); }

  /* Admin-picked bar colour (applies to classic/center/pill/strip, and to
     ghost's scrolled state). */
  .ps-navc-paper { background: color-mix(in srgb, var(--paper) 85%, transparent); }
  .ps-navc-white { background: rgba(255,255,255,.92); }
  .ps-navc-dark  { background: color-mix(in srgb, var(--ink) 96%, transparent); }
  .ps-navc-brand { background: color-mix(in srgb, var(--ps1) 96%, transparent); }
  /* Dark/brand bars flip text to light. */
  .ps-nav-ondark { border-color: rgba(255,255,255,.08); }
  /* Scoped to the nav element this missed the ACTIONS — Login and the CTA sit outside the
     <nav> element, so on a dark or brand bar every menu link went white and
     Login alone kept the default slate, reading as disabled. It is a selector
     that did not reach, not a colour a school configured badly. */
  .ps-nav-ondark nav, .ps-nav-ondark .ps-nav-link { color: rgba(255,255,255,.92); }
  .ps-nav-ondark .ps-nav-link:hover { background: rgba(255,255,255,.12); }
  .ps-nav-ondark .ps-nav-name { color: #fff; }

  /* ── Login button ────────────────────────────────────────────────────────
     A school can give sign-in a real edge when a plain link disappears into
     its bar. LINK is the default and is exactly what shipped, so choosing
     nothing changes nothing. Both other styles derive from the CURRENT text
     colour, so they stay legible on paper, white, dark, brand and ghost bars
     without the school having to think about contrast at all. */
  /* Both derive from currentColor, so neither can be configured into
     invisibility: whatever the bar did to the text, the edge and the fill
     follow it. Deliberately NOT the accent — that belongs to the one primary
     action, and a second accent-coloured control competes with it. */
  .ps-login-outline { border: 1.5px solid currentColor; border-radius: 12px; opacity: .95; }
  .ps-login-solid { background: color-mix(in srgb, currentColor 16%, transparent); border-radius: 12px; }
  .ps-login-solid:hover { background: color-mix(in srgb, currentColor 24%, transparent); }

  /* Ghost: fully transparent until scrolled, then the colour class shows. */
  .ps-nav-ghost:not(.ps-nav-scrolled) { background: transparent; }
  .ps-nav-ghost .ps-nav-link { color: rgba(255,255,255,.92); }
  .ps-nav-ghost .ps-nav-link:hover { background: rgba(255,255,255,.14); }
  .ps-nav-ghost .ps-nav-name { color: #fff; }
  /* Ghost with dark text at top (admin "Text on photo" = Dark, or Auto over a
     light paper wash) — white links are invisible on a washed-out photo. */
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-link { color: #475569; }
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-link:hover { background: rgba(0,0,0,.06); }
  .ps-nav-ghost-darktext:not(.ps-nav-scrolled) .ps-nav-name { color: var(--ink); }
  .ps-nav-ghost.ps-nav-scrolled { backdrop-filter: blur(8px); border-color: rgba(0,0,0,.05); }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-link { color: #475569; }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-link:hover { background: rgba(0,0,0,.05); }
  .ps-nav-ghost.ps-nav-scrolled:not(.ps-nav-ondark) .ps-nav-name { color: var(--ink); }

  /* ── Admissions: journey path (homepage) ── */
  .ps-journey { position: relative; }
  .ps-jline { position: absolute; top: 16px; left: 2%; right: 2%; height: 30px; }
  .ps-jline-mask { width: 0%; height: 100%; overflow: hidden;
    transition: width 1s cubic-bezier(.4,0,.2,1) .1s; }
  .ps-journey.in .ps-jline-mask { width: 100%; }
  .ps-jbadge { position: relative; z-index: 1; display: inline-grid; place-items: center;
    min-width: 34px; height: 34px; border-radius: 999px; padding: 0 10px;
    font-size: 11px; font-weight: 800; letter-spacing: .1em;
    box-shadow: 0 0 0 6px var(--paper);
    transform: scale(0); transition: transform .5s cubic-bezier(.34,1.56,.64,1); }
  .ps-journey.in .ps-jbadge { transform: scale(1); }
  .ps-jbody { opacity: 0; transform: translateY(calc(18px * var(--motion) + 4px)); margin-top: 10px;
    transition: opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
  .ps-journey.in .ps-jbody { opacity: 1; transform: none; }
  .ps-journey.in .ps-jbody:hover { transform: translateY(-6px); box-shadow: 0 30px 60px -28px rgba(28,45,36,.45); }

  /* ── Admissions: timeline rail (/admissions page) ── */
  .ps-rail { position: relative; }
  .ps-rail-line, .ps-rail-fill { position: absolute; top: 8px; bottom: 8px; left: 14px; width: 3px; border-radius: 2px; }
  .ps-rail-line { background: rgba(28,45,36,.1); }
  .ps-rail-fill { background: linear-gradient(180deg, var(--ps1), var(--ps2)); bottom: auto; height: 0;
    transition: height 1.6s cubic-bezier(.4,0,.2,1) .15s; }
  .ps-rail.in .ps-rail-fill { height: calc(100% - 16px); }
  .ps-rstep { position: relative; opacity: 0; transition: opacity .55s ease, transform .55s cubic-bezier(.2,.7,.2,1); }
  .ps-rdot { position: absolute; top: 22px; width: 13px; height: 13px; border-radius: 999px;
    background: var(--ps2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ps1) 25%, transparent); }
  .ps-rail.in .ps-rstep { opacity: 1; transform: none; }
  @media (min-width: 768px) {
    .ps-rail-line, .ps-rail-fill { left: 50%; margin-left: -1.5px; }
    .ps-rstep { width: 46%; }
    .ps-rstep-l { margin-right: auto; transform: translateX(calc(-22px * var(--motion))); }
    .ps-rstep-l .ps-rdot { right: -9.2%; margin-right: -6.5px; }
    .ps-rstep-r { margin-left: auto; transform: translateX(calc(22px * var(--motion))); }
    .ps-rstep-r .ps-rdot { left: -9.2%; margin-left: -6.5px; }
  }
  @media (max-width: 767.98px) {
    .ps-rstep { margin-left: 40px; transform: translateY(calc(14px * var(--motion))); }
    .ps-rstep .ps-rdot { left: -32.5px; }
  }

  /* ── Gallery lightbox ── */
  .ps-lb { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 1.25rem;
    background: rgba(16,26,20,.85); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    animation: ps-lb-fade .25s ease; }
  @keyframes ps-lb-fade { from { opacity: 0; } to { opacity: 1; } }
  .ps-lb-img { animation: ps-lb-zoom .32s cubic-bezier(.2,.7,.2,1); }
  @keyframes ps-lb-zoom { from { opacity: 0; transform: scale(.92) translateY(10px); } to { opacity: 1; transform: none; } }
  .ps-lb-closing { animation: ps-lb-fade .2s ease reverse forwards; }
  .ps-lb-closing .ps-lb-img { animation: ps-lb-zoomout .2s ease forwards; }
  @keyframes ps-lb-zoomout { to { opacity: 0; transform: scale(.94); } }

  /* ── Hall of fame podium rise ── */
  @keyframes ps-rise { to { opacity: 1; transform: none; } }
  .ps-champ { opacity: 0; transform: translateY(26px); animation: ps-rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
  .ps-champ-2 { animation-delay: .18s; }
  .ps-champ-3 { animation-delay: .34s; }

  @media (prefers-reduced-motion: reduce) {
    .ps-root { --motion: 0 !important; }
    .reveal { opacity: 1; transform: none; }
    .ps-underline path { stroke-dashoffset: 0; }
    .ps-flip-inner { transition: none; }
    .ps-gesture-draw .reveal { clip-path: none; transition: none; }
    .ps-gesture-curtain .reveal { clip-path: none; transition: none; }
    /* These out-specify the .reveal reset above, so re-state their end state. */
    .ps-gesture-slide .reveal, .ps-gesture-zoom .reveal, .ps-gesture-flip .reveal { transform: none; transition: none; }
    .ps-accent-mark::after { transition: none; transform: scaleX(1); }
    .ps-menu-card, .ps-menu-row { animation: none; }
    .ps-menu-row, .ps-menu-row-arrow { transition: none; }
    .ps-amb { animation: none; }
    .ps-champ { animation: none; opacity: 1; transform: none; }
    .ps-marker { animation: none; background-size: 100% .38em; }
    .ps-accent-grow { animation: none; transform: scaleX(1); }
    .ps-slide { transition: none; }
    .ps-kb { animation: none; }
    .ps-lb, .ps-lb-img, .ps-lb-closing, .ps-lb-closing .ps-lb-img { animation: none; }
    .ps-jline-mask, .ps-jbadge, .ps-jbody, .ps-rail-fill, .ps-rstep { transition: none; }
    .ps-jline-mask { width: 100%; }
    .ps-jbadge { transform: scale(1); }
    .ps-jbody, .ps-rstep { opacity: 1; transform: none; }
    .ps-rail-fill { height: calc(100% - 16px); }
  }
  /* ═══════════════ WEBSITE STUDIO ADDITIONS ═══════════════
     Every rule below belongs to a NON-DEFAULT choice: the classes only exist
     when an admin picked something, so none of this affects a school that has
     not opened the studio. Panels keep using the shape tokens — a variant may
     rearrange a band, never re-skin it. */

  /* ── Scroll feel ── */
  html:has(.ps-scroll-snap) { scroll-snap-type: y proximity; }
  .ps-scroll-snap [data-sec] { scroll-snap-align: start; scroll-margin-top: 4.5rem; }
  /* Deck: each band sticks and the next slides over it. EVERY top-level band
     participates and gets a solid paper ground — not just the data-sec ones —
     so a transparent band (Hall of Fame, Events, Contact) can never show the
     stuck band through it. Where sticky does not engage it degrades to a normal
     paper-backed scroll, never to overlapping text. */
  .ps-scroll-deck > section, .ps-scroll-deck > div[data-sec], .ps-scroll-deck > footer {
    position: sticky; top: 0;
    box-shadow: 0 -18px 44px rgba(15,23,20,.14); }
  /* The opaque ground the deck needs goes on TRANSPARENT bands only. A band that
     brings its own colour + light text (Events = .ps-brandgrad.text-white, a
     dark/brand footer) already has an opaque background — forcing paper onto it
     put white text on a white band, i.e. an invisible section/footer. */
  .ps-scroll-deck > section:not(.text-white),
  .ps-scroll-deck > div[data-sec],
  .ps-scroll-deck > footer:not(.ps-footc-dark):not(.ps-footc-brand) {
    background: var(--paper); }
  .ps-scroll-deck > #ps-nav, .ps-scroll-deck > header { position: sticky; }
  /* Deck just forced an overlaying (fixed) floating nav into the flow, so the
     hero's reserved padding for a bar that would sit ON TOP of it turns into a
     double gap between the navbar and the first screen. Collapse it back to
     the in-flow values the hero uses when the nav never overlays. */
  .ps-scroll-deck [data-sec="hero"] .pt-24 { padding-top: 1.5rem; }
  .ps-scroll-deck [data-sec="hero"] .pt-28 { padding-top: 3.5rem; }
  /* Side-scroll: the home bands become full-viewport panels in a horizontal
     track. Desktop + motion-allowed only — on phones and under reduced-motion
     the track stays a normal column, so the page can never break there. Touch
     keeps its native horizontal swipe; the wheel-to-sideways effect is layered
     on top. Each band keeps its own vertical scroll for content over one screen. */
  @media (min-width: 768px) and (prefers-reduced-motion: no-preference) {
    /* Pinned horizontal: the sticky viewport holds still while the JS reserves
       vertical scroll room on the wrapper and slides the track sideways as the
       page scrolls down. Off this media (phones, reduced-motion) every element
       is a plain block, so the bands fall back to a normal vertical column. */
    .ps-scroll-horizontal .ps-hwrap { position: relative; }
    .ps-scroll-horizontal .ps-hsticky {
      position: sticky; top: 0;
      height: 100vh; height: 100dvh;
      overflow: hidden;
      display: flex; align-items: stretch;
    }
    .ps-scroll-horizontal .ps-htrack {
      display: flex; flex-wrap: nowrap; align-items: stretch;
      height: 100%;
      will-change: transform;
    }
    .ps-scroll-horizontal .ps-htrack > * {
      flex: 0 0 100vw; max-width: 100vw; height: 100%;
      overflow-y: auto; overflow-x: hidden;
    }
  }

  /* ── Scroll-driven feels (Zoom-through / Reveal / Tilt) ──
     Continuous, tied to each band's position in the viewport via CSS view()
     scroll-timelines — no JS, GPU-driven by the browser. Guarded by @supports:
     a browser without scroll-timelines simply skips the whole block and renders
     the bands normally (never stuck mid-animation). Off for reduced-motion and
     for Animation=Off. The hero is left alone. */
  @supports (animation-timeline: view()) {
    @media (prefers-reduced-motion: no-preference) {
      @keyframes ps-sf-zoom {
        0%   { transform: scale(.86); opacity: .5; }
        50%  { transform: none;       opacity: 1; }
        100% { transform: scale(.86); opacity: .5; }
      }
      @keyframes ps-sf-reveal {
        /* Static edges at -3rem: an inset(0) fill state would clip each band
           to its box forever, amputating panel shadows and card overhangs. */
        from { clip-path: inset(-3rem 100% -3rem -3rem); }
        to   { clip-path: inset(-3rem); }
      }
      @keyframes ps-sf-tilt {
        0%   { transform: perspective(1100px) rotateX(11deg);  opacity: .55; }
        50%  { transform: perspective(1100px) rotateX(0);      opacity: 1; }
        100% { transform: perspective(1100px) rotateX(-11deg); opacity: .55; }
      }
      .ps-scroll-zoom:not(.ps-motion-off) [data-sec]:not([data-sec="hero"]) {
        animation: ps-sf-zoom linear both; animation-timeline: view(); }
      .ps-scroll-reveal:not(.ps-motion-off) [data-sec]:not([data-sec="hero"]) {
        animation: ps-sf-reveal linear both; animation-timeline: view();
        animation-range: entry 8% cover 34%; }
      .ps-scroll-tilt:not(.ps-motion-off) [data-sec]:not([data-sec="hero"]) {
        animation: ps-sf-tilt linear both; animation-timeline: view();
        transform-style: preserve-3d; }
    }
  }

  /* ── Nav menu open animation (FADE = the shipped ps-menu-in, no class) ── */
  @keyframes ps-menu-in-slide { from { opacity: 0; transform: translateY(calc(-16px * var(--motion) - 2px)); } to { opacity: 1; transform: none; } }
  @keyframes ps-menu-in-scale { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: none; } }
  .ps-menuanim-slide .ps-menu-card { animation-name: ps-menu-in-slide; animation-duration: .26s; }
  .ps-menuanim-scale .ps-menu-card { animation-name: ps-menu-in-scale; animation-duration: .2s; }

  /* ── Per-section entrance override (ps-sg-*) ──
     Beats the page-wide gesture by specificity; loses, on purpose, to the
     reduced-motion and motion-off blocks at the end of this stylesheet. */
  .ps-root .ps-sg-rise .reveal { opacity: 0; clip-path: none;
    transform: translateY(calc(26px * var(--motion) + 4px));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-rise .reveal.in { opacity: 1; transform: none; }
  .ps-root .ps-sg-fade .reveal { opacity: 0; transform: none; clip-path: none;
    transition: opacity .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-fade .reveal.in { opacity: 1; }
  .ps-root .ps-sg-draw .reveal { opacity: 1; transform: none;
    clip-path: inset(-3rem 100% -3rem -3rem);
    transition: clip-path .85s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-draw .reveal.in { clip-path: inset(-3rem); }
  .ps-root .ps-sg-slide .reveal { opacity: 0; clip-path: none;
    transform: translateX(calc(-44px * var(--motion) - 6px));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-slide .reveal.in { opacity: 1; transform: none; }
  .ps-root .ps-sg-zoom .reveal { opacity: 0; clip-path: none;
    transform: scale(calc(1 - 0.12 * var(--motion)));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-zoom .reveal.in { opacity: 1; transform: none; }
  .ps-root .ps-sg-curtain .reveal { opacity: 1; transform: none;
    clip-path: inset(-3rem -3rem 100% -3rem);
    transition: clip-path .8s cubic-bezier(.4,0,.1,1); }
  .ps-root .ps-sg-curtain .reveal.in { clip-path: inset(-3rem); }
  .ps-root .ps-sg-flip .reveal { opacity: 0; clip-path: none; transform-origin: top center;
    transform: perspective(900px) rotateX(calc(-18deg * var(--motion)));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-flip .reveal.in { opacity: 1; transform: none; }

  /* ── Stats variants ── */
  .ps-v-stats-strip .ps-statcard { background: transparent; border: 0; box-shadow: none;
    border-radius: 0; border-left: 1px solid rgba(28,45,36,.14); }
  .ps-v-stats-strip .ps-statcard:first-child { border-left: 0; }
  .ps-v-stats-strip.ps-stats-grid { gap: 0; border-block: 1px solid rgba(28,45,36,.14);
    padding-top: 1.6rem; padding-bottom: 1.6rem; }
  .ps-ring { width: 7rem; height: 7rem; border-radius: 999px; margin: 0 auto .6rem;
    display: grid; place-items: center;
    background: conic-gradient(var(--ps2) calc(var(--ps-ring-p, 80) * 1%), color-mix(in srgb, var(--ps1) 14%, transparent) 0); }
  .ps-ring > span { width: 5.4rem; height: 5.4rem; border-radius: 999px; background: var(--paper);
    display: grid; place-items: center; }
  .ps-v-stats-rings .ps-statcard { background: transparent; border: 0; box-shadow: none; }
  /* Odometer: numerals roll up (the count-up hook) on a dark counter tile. */
  .ps-v-stats-odometer .ps-statcard { background: #141a17; border: 0;
    box-shadow: 0 12px 30px -18px rgba(0,0,0,.75); }
  .ps-v-stats-odometer .ps-statnum { color: var(--ps2); font-variant-numeric: tabular-nums; letter-spacing: .01em; }
  .ps-v-stats-odometer .ps-statlabel { color: rgba(255,255,255,.6); }
  /* Big numerals: oversized, bare, no card. */
  .ps-v-stats-bignum .ps-statcard { background: transparent; border: 0; box-shadow: none; padding: .5rem; }
  .ps-v-stats-bignum .ps-statnum { line-height: .92; letter-spacing: -.03em; }
  /* Bar fill: a figure over a track that grows to its width as the card arrives. */
  .ps-v-stats-bars .ps-statcard { background: transparent; border: 0; box-shadow: none; text-align: left; }
  .ps-bar-track { height: .5rem; border-radius: 999px; margin: .55rem 0 .1rem; overflow: hidden;
    background: color-mix(in srgb, var(--ps1) 12%, transparent); }
  .ps-bar-fill { display: block; height: 100%; width: 0; border-radius: 999px;
    background: linear-gradient(90deg, var(--ps1), var(--ps2));
    transition: width 1s cubic-bezier(.2,.7,.2,1); }
  .ps-statcard.in .ps-bar-fill { width: var(--ps-bar-w, 75%); }

  /* ── About variants ── */
  .ps-v-about-overlap .ps-about-img-wrap::before { content: ""; position: absolute;
    inset: -14px 14px 14px -14px; border: 2px solid var(--ps2);
    border-radius: var(--ps-radius); opacity: .55; }
  /* Narrative uses the FULL band: the copy keeps a readable centred measure,
     but the photo stretches wide beneath it — a narrow 46rem column floating
     inside a 72rem framed panel read as broken, not elegant. */
  .ps-v-about-center.ps-about-grid { grid-template-columns: 1fr !important; text-align: center; }
  .ps-v-about-center .ps-about-copy { max-width: 52rem; margin-inline: auto; width: 100%; }
  .ps-v-about-center .ps-about-img-wrap { order: 2; width: 100%; }
  .ps-v-about-center .ps-about-img { height: clamp(14rem, 34vw, 24rem); }
  .ps-v-about-center .ps-about-copy blockquote { border-left: 0; padding-left: 0; }

  /* LETTER: the note reads as a sheet of school stationery — bordered paper,
     a brand letterhead rule on top, the principal's line closing it like a
     sign-off, and the campus photo tucked quietly below the sheet. */
  .ps-v-about-letter.ps-about-grid { grid-template-columns: 1fr !important; gap: 2.2rem; }
  @media (min-width: 1024px) {
    .ps-v-about-letter.ps-about-grid { grid-template-columns: 1.35fr 1fr !important; align-items: stretch; }
    .ps-v-about-letter .ps-about-img { height: 100%; min-height: 24rem; }
  }
  .ps-v-about-letter .ps-about-copy { position: relative; background: var(--paper);
    border: 1px solid color-mix(in srgb, var(--ps1) 16%, transparent);
    border-radius: 6px; padding: clamp(1.6rem, 4.5vw, 3rem);
    box-shadow: 0 26px 50px -34px rgba(17, 20, 28, .4); }
  .ps-v-about-letter .ps-about-copy::before { content: ""; position: absolute;
    top: 0; left: 0; right: 0; height: 4px; border-radius: 6px 6px 0 0;
    background: linear-gradient(90deg, var(--ps1), var(--ps2)); }
  .ps-v-about-letter .ps-about-copy h2 { font-size: 1.85rem; }
  .ps-v-about-letter .ps-about-copy blockquote { border-left: 0; padding: 1.1rem 0 0;
    margin-top: 1.5rem; font-size: .95rem;
    border-top: 1px dashed color-mix(in srgb, var(--ps1) 30%, transparent); }
  .ps-v-about-letter .ps-about-img-wrap { order: 2; }
  .ps-v-about-letter .ps-about-img { height: 16rem; }
  .ps-v-about-letter .ps-about-glow { display: none; }

  /* QUOTE: the principal's message IS the band — set display-size in the
     heading face under an oversized quote mark; the stock headline demotes to
     a small subhead and the photo becomes a wide strip with the signature card
     centred beneath it. Without a message it gracefully reads as Narrative. */
  .ps-v-about-quote.ps-about-grid { grid-template-columns: 1fr !important; text-align: center; }
  @media (min-width: 1024px) {
    .ps-v-about-quote.ps-about-grid { grid-template-columns: 1.25fr 1fr !important;
      text-align: left; align-items: center; }
    .ps-v-about-quote .ps-about-copy { align-items: flex-start; }
    .ps-v-about-quote .ps-about-copy p { margin-inline: 0; }
    .ps-v-about-quote .ps-about-img-wrap { order: 2; margin-bottom: 0; }
    .ps-v-about-quote .ps-about-img { height: 26rem; }
  }
  .ps-v-about-quote .ps-about-copy { display: flex; flex-direction: column; align-items: center; }
  .ps-v-about-quote .ps-about-copy blockquote { order: 1; border-left: 0; padding-left: 0;
    margin-top: 1.1rem; max-width: 46rem; font-style: normal;
    font-family: var(--font-head); color: var(--ink);
    font-size: clamp(1.45rem, 3.2vw, 2.05rem); line-height: 1.35; font-weight: 600; }
  .ps-v-about-quote .ps-about-copy blockquote::before { content: "“"; display: block;
    font-family: Georgia, 'Times New Roman', serif; font-size: 3.8rem; line-height: .55;
    color: var(--ps2); margin-bottom: .55rem; }
  .ps-v-about-quote .ps-about-copy h2 { order: 2; font-size: 1.1rem; margin-top: 2.1rem;
    letter-spacing: .02em; opacity: .85; }
  .ps-v-about-quote .ps-about-copy p { order: 3; font-size: .95rem; max-width: 40rem; margin-top: .8rem; }
  .ps-v-about-quote .ps-about-img-wrap { order: 2; margin-bottom: 1.6rem; }
  .ps-v-about-quote .ps-about-img { height: 16rem; }
  .ps-v-about-quote .ps-about-img-wrap > .ps-card.absolute { right: auto; left: 50%;
    transform: translateX(-50%); bottom: -1.55rem; }

  /* EDITORIAL: magazine spread — full-width photo as the opening image, the
     story flowing in two columns behind a drop cap, and the principal's line
     as a centred pull-quote between hairline rules. */
  .ps-v-about-editorial.ps-about-grid { grid-template-columns: 1fr !important; gap: 2.6rem; }
  .ps-v-about-editorial .ps-about-img { height: clamp(14rem, 32vw, 24rem); border-radius: var(--ps-radius); }
  @media (min-width: 1280px) { .ps-v-about-editorial .ps-about-copy p { columns: 3; } }
  .ps-v-about-editorial .ps-about-glow { display: none; }
  .ps-v-about-editorial .ps-about-copy p { margin-top: 1.5rem; column-gap: 2.6rem; }
  @media (min-width: 768px) { .ps-v-about-editorial .ps-about-copy p { columns: 2; } }
  .ps-v-about-editorial .ps-about-copy p::first-letter { float: left; font-weight: 700;
    font-family: var(--font-head); color: var(--ps1);
    font-size: 3.4rem; line-height: .82; padding: .06em .14em 0 0; }
  .ps-v-about-editorial .ps-about-copy blockquote { border-left: 0; padding: 1.1rem 0;
    margin-top: 1.7rem; text-align: center; font-size: 1.08rem; max-width: 34rem; margin-inline: auto;
    border-top: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 16%, transparent); }

  /* ── Courses variants ── */
  .ps-v-courses-carousel .ps-courses-grid { display: flex; overflow-x: auto; gap: 1.25rem;
    scroll-snap-type: x mandatory; padding-bottom: .75rem;
    -webkit-overflow-scrolling: touch; }
  .ps-v-courses-carousel .ps-courses-grid > .reveal { flex: 0 0 min(78%, 320px); scroll-snap-align: start; }
  .ps-v-courses-rows .ps-courses-grid { grid-template-columns: minmax(0, 1fr) !important;
    max-width: 42rem; margin-inline: auto; }
  /* SHOWCASE: each programme becomes a wide feature row — photo beside the
     story, alternating sides. The flip interaction stays; only the front
     face's geometry changes. */
  .ps-v-courses-showcase .ps-courses-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 1.75rem; }
  @media (min-width: 768px) {
    .ps-v-courses-showcase .ps-face:not(.ps-face-back) { display: grid;
      grid-template-columns: 44% 1fr; align-items: stretch; }
    .ps-v-courses-showcase .ps-face:not(.ps-face-back) > div:first-child { height: 100%; min-height: 15rem; }
    .ps-v-courses-showcase .ps-courses-grid > .reveal:nth-child(even) .ps-face:not(.ps-face-back) { direction: rtl; }
    .ps-v-courses-showcase .ps-courses-grid > .reveal:nth-child(even) .ps-face:not(.ps-face-back) > * { direction: ltr; }
    .ps-v-courses-showcase .ps-face:not(.ps-face-back) .p-5 { padding: 1.75rem 2rem; justify-content: center; }
  }
  /* COVERS: tall photo tiles — the image fills the card and the copy sits on
     a dark wash at its foot. Cards without a photo keep the programme mark. */
  .ps-v-courses-covers .ps-flip, .ps-v-courses-covers .ps-flip-inner { min-height: 22rem; }
  /* The face KEEPS the base absolute/inset-0 sizing — overriding it to
     relative collapses the card to its (all-absolute) children. */
  .ps-v-courses-covers .ps-face:not(.ps-face-back) { overflow: hidden; }
  .ps-v-courses-covers .ps-face:not(.ps-face-back) > div:first-child {
    position: absolute; inset: 0; height: 100% !important; }
  .ps-v-courses-covers .ps-face:not(.ps-face-back) .p-5 { position: absolute; left: 0; right: 0; bottom: 0;
    padding-top: 3.5rem;
    background: linear-gradient(to top, rgba(10, 14, 20, 0.88) 30%, rgba(10, 14, 20, 0.45) 70%, transparent); }
  .ps-v-courses-covers .ps-face:not(.ps-face-back) .p-5 h3 { color: #fff; }
  .ps-v-courses-covers .ps-face:not(.ps-face-back) .p-5 p { color: rgba(255, 255, 255, 0.8); }
  .ps-v-courses-covers .ps-face:not(.ps-face-back) .p-5 span { color: #fff !important; }

  /* ── Admissions TILES (JOURNEY and STEPPER reuse the shipped variants) ── */
  .ps-v-admissions-tiles .ps-jline { display: none; }
  .ps-v-admissions-tiles .ps-journey .grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 1.4rem; }
  .ps-v-admissions-tiles .ps-journey .grid > div { position: relative; }
  .ps-v-admissions-tiles .ps-jbadge { position: absolute; top: -12px; left: -8px; z-index: 2;
    box-shadow: 0 0 0 4px var(--paper); }
  .ps-v-admissions-tiles .ps-jbody { margin-top: 0; padding-top: 1.6rem; }
  @media (max-width: 640px) {
    .ps-v-admissions-tiles .ps-journey .grid { grid-template-columns: 1fr !important; }
  }
  /* CARDS: no path — each step is a lifted card with a brand rule on top and an
     oversized ghost step-number in its corner. The badge's ink/accent colours
     are inline on the element, hence the !important overrides. */
  .ps-v-admissions-cards .ps-jline { display: none; }
  .ps-v-admissions-cards .ps-journey .grid { gap: 1.3rem; }
  .ps-v-admissions-cards .ps-journey .grid > div { position: relative; }
  .ps-v-admissions-cards .ps-jbadge { position: absolute; top: .55rem; right: 1rem; z-index: 1;
    background: transparent !important; color: color-mix(in srgb, var(--ps1) 24%, transparent) !important;
    box-shadow: none; border: 0; padding: 0; font-size: 3.2rem; font-weight: 800;
    letter-spacing: -.04em; line-height: 1; }
  .ps-v-admissions-cards .ps-jbody { margin-top: 0; position: relative; overflow: hidden;
    padding: 1.5rem 1.25rem 1.35rem; border: 0; box-shadow: 0 20px 40px -26px rgba(17,20,28,.45); }
  .ps-v-admissions-cards .ps-jbody::before { content: ""; position: absolute; top: 0; left: 0; right: 0;
    height: 4px; background: linear-gradient(90deg, var(--ps1), var(--ps2)); }
  /* BLOCKS: every step a brand-gradient panel with light text; the number badge
     rides the top edge on a paper ring. Even steps reverse the gradient so the
     row alternates without ever putting text on the light accent alone. */
  .ps-v-admissions-blocks .ps-jline { display: none; }
  .ps-v-admissions-blocks .ps-journey .grid { gap: 1.4rem; }
  .ps-v-admissions-blocks .ps-journey .grid > div { position: relative; }
  .ps-v-admissions-blocks .ps-jbadge { position: absolute; top: -12px; left: 14px; z-index: 2;
    box-shadow: 0 0 0 4px var(--paper); }
  .ps-v-admissions-blocks .ps-jbody { margin-top: 0; padding: 1.7rem 1.25rem 1.4rem; border: 0;
    background: linear-gradient(135deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2))); }
  .ps-v-admissions-blocks .ps-jbody h3 { color: #fff; }
  .ps-v-admissions-blocks .ps-jbody p { color: rgba(255,255,255,.82); }
  .ps-v-admissions-blocks .ps-journey .grid > div:nth-child(even) .ps-jbody {
    background: linear-gradient(315deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2))); }

  /* ── Gallery variants ── */
  .ps-v-gallery-masonry .ps-gallery-grid { display: block; columns: 2; column-gap: 1rem; }
  @media (min-width: 768px) { .ps-v-gallery-masonry .ps-gallery-grid { columns: 3; } }
  .ps-v-gallery-masonry .ps-gallery-grid > button { display: block; width: 100%; margin-bottom: 1rem;
    break-inside: avoid; }
  .ps-v-gallery-masonry .ps-gallery-grid > button:nth-child(3n+1) img { height: 15rem; }
  .ps-v-gallery-masonry .ps-gallery-grid > button:nth-child(3n) img { height: 10rem; }
  .ps-v-gallery-filmstrip .ps-gallery-grid { display: flex; overflow-x: auto; gap: 1rem;
    scroll-snap-type: x proximity; padding-bottom: .75rem; -webkit-overflow-scrolling: touch; }
  .ps-v-gallery-filmstrip .ps-gallery-grid > button { flex: 0 0 16rem; scroll-snap-align: start; }
  /* MOSAIC: the first photo is the feature — a two-cell span both ways; the rest
     keep the even grid and dense flow backfills any hole. */
  .ps-v-gallery-mosaic .ps-gallery-grid { grid-auto-flow: dense; }
  .ps-v-gallery-mosaic .ps-gallery-grid > button:first-child { grid-column: span 2; grid-row: span 2; }
  .ps-v-gallery-mosaic .ps-gallery-grid > button:first-child img { height: 25rem; }
  /* POLAROID: white print borders with a deep chin, pinned at alternating tilts;
     hover straightens the print. Respect reduced motion by keeping tilts static. */
  .ps-v-gallery-polaroid .ps-gallery-grid { gap: 1.5rem; }
  .ps-v-gallery-polaroid .ps-gallery-grid > button { background: #fff; border: 0; border-radius: 4px;
    padding: .55rem .55rem 2.1rem; box-shadow: 0 16px 32px -20px rgba(17,20,28,.5);
    transform: rotate(-1.6deg); transition: transform .25s ease; }
  .ps-v-gallery-polaroid .ps-gallery-grid > button:nth-child(even) { transform: rotate(1.4deg); }
  .ps-v-gallery-polaroid .ps-gallery-grid > button:nth-child(3n) { transform: rotate(-.5deg); }
  .ps-v-gallery-polaroid .ps-gallery-grid > button:hover { transform: rotate(0) scale(1.03); z-index: 2; }
  .ps-v-gallery-polaroid .ps-gallery-grid > button img { border-radius: 2px; height: 10.5rem; }

  /* ── Staff LIST variant ── */
  .ps-v-staff-list .ps-staff-grid { grid-template-columns: minmax(0, 1fr) !important;
    max-width: 40rem; margin-inline: auto; gap: .75rem; }
  .ps-v-staff-list .ps-staffcard { display: flex; align-items: center; gap: 1rem;
    text-align: left; padding: .9rem 1.1rem; }
  .ps-v-staff-list .ps-staffcard > div:first-child { margin: 0; height: 3.2rem; width: 3.2rem;
    font-size: 1.1rem; flex: none; }
  .ps-v-staff-list .ps-staffcard .ps-head { margin-top: 0; }
  /* SPOTLIGHT: the first educator (usually the head) becomes a full-width
     feature row; the rest keep the portrait grid beneath. */
  .ps-v-staff-spotlight .ps-staff-grid > .ps-staffcard:first-child { grid-column: 1 / -1;
    display: flex; align-items: center; gap: 1.6rem; text-align: left;
    padding: 1.6rem clamp(1.2rem, 4vw, 2.2rem); }
  .ps-v-staff-spotlight .ps-staff-grid > .ps-staffcard:first-child > div:first-child {
    margin: 0; height: 6.5rem; width: 6.5rem; font-size: 2.2rem; flex: none; }
  .ps-v-staff-spotlight .ps-staff-grid > .ps-staffcard:first-child .ps-head {
    margin-top: 0; font-size: 1.45rem; }
  /* MINIMAL: no cards at all — ringed round portraits on the page itself. */
  .ps-v-staff-minimal .ps-staffcard { background: transparent; border: 0; box-shadow: none; padding: .9rem .5rem; }
  .ps-v-staff-minimal .ps-staffcard > div:first-child { height: 6.2rem; width: 6.2rem; font-size: 1.9rem;
    box-shadow: 0 0 0 4px var(--paper), 0 0 0 6px color-mix(in srgb, var(--ps1) 35%, transparent); }

  /* ── Contact variants ──
     WIZARD: a conversational form — progress thread, one question per screen
     sliding in, underline inputs, pill options, and a drawn-check finale.
     FLOAT: the form floats on a brand band inside a lit white card. */
  .ps-wiz-track { display: block; height: 6px; border-radius: 999px; overflow: hidden;
    background: color-mix(in srgb, var(--ps1) 14%, transparent); }
  .ps-wiz-fill { display: block; height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, var(--ps1), var(--ps2));
    transition: width .45s cubic-bezier(.2,.7,.2,1); }
  .ps-wiz-step { animation: ps-wiz-in .38s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes ps-wiz-in {
    from { opacity: 0; transform: translateX(calc(28px * var(--motion))); }
    to { opacity: 1; transform: none; } }
  .ps-wiz-input { border: 0; border-bottom: 2px solid color-mix(in srgb, var(--ps1) 24%, transparent);
    border-radius: 0; background: transparent; color: var(--ink); transition: border-color .25s; }
  .ps-wiz-input:focus { outline: none; border-bottom-color: var(--ps1); }
  .ps-wiz-input::placeholder { color: #94a3b8; }
  .ps-wiz-opt { border: 1.5px solid color-mix(in srgb, var(--ps1) 32%, transparent); border-radius: 999px;
    padding: .55rem 1.15rem; font-size: .9rem; font-weight: 600; color: var(--ink);
    transition: transform .2s, border-color .2s, background .2s, color .2s; }
  .ps-wiz-opt:hover { transform: translateY(calc(-2px * var(--motion))); border-color: var(--ps1); }
  .ps-wiz-opt-on { background: var(--ps1); border-color: var(--ps1); color: #fff; }
  .ps-wiz-done { animation: ps-wiz-in .4s ease-out both; }
  .ps-wiz-check circle { stroke-dasharray: 183; stroke-dashoffset: 183;
    animation: ps-wiz-draw .7s ease-out forwards; }
  .ps-wiz-check path { stroke-dasharray: 40; stroke-dashoffset: 40;
    animation: ps-wiz-draw .45s ease-out .55s forwards; }
  @keyframes ps-wiz-draw { to { stroke-dashoffset: 0; } }
  .ps-motion-off .ps-wiz-step, .ps-motion-off .ps-wiz-done { animation: none; }
  .ps-motion-off .ps-wiz-check circle, .ps-motion-off .ps-wiz-check path {
    animation: none; stroke-dashoffset: 0; }

  .ps-cf-band { border-radius: var(--ps-radius);
    background: linear-gradient(130deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2)));
    box-shadow: 0 30px 60px -32px color-mix(in srgb, var(--ps1) 60%, transparent); }
  .ps-cf-underline { width: 74px; height: 4px; border-radius: 999px; background: var(--ps2); }
  .ps-cf-chip { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.28); color: #fff; }
  .ps-cf-card { position: relative; isolation: isolate; background: #fff; border-radius: 18px;
    padding: 1.6rem; box-shadow: 0 26px 52px -26px rgba(15, 20, 40, .5); }
  .ps-cf-card::before { content: ""; position: absolute; inset: -2px; border-radius: 20px; z-index: -1;
    background: linear-gradient(120deg, var(--ps2), rgba(255,255,255,.7), var(--ps2));
    background-size: 220% 220%;
    animation: ps-cf-border 6s linear infinite; }
  @keyframes ps-cf-border { to { background-position: 220% 50%; } }
  .ps-cf-card input:focus, .ps-cf-card textarea:focus, .ps-cf-card select:focus {
    transform: translateY(calc(-2px * var(--motion)));
    box-shadow: 0 12px 24px -16px color-mix(in srgb, var(--ps1) 60%, transparent); }
  .ps-cf-card input, .ps-cf-card textarea, .ps-cf-card select {
    transition: transform .2s, box-shadow .2s; }
  .ps-motion-off .ps-cf-card::before { animation: none; }
  @media (prefers-reduced-motion: reduce) {
    .ps-wiz-step, .ps-wiz-done, .ps-cf-card::before { animation: none; }
    .ps-wiz-check circle, .ps-wiz-check path { animation: none; stroke-dashoffset: 0; }
  }

  /* ── Footer variants (FooterSection; COLUMNS on paper = shipped, no class) ── */
  .ps-footc-dark { background: color-mix(in srgb, var(--ink) 94%, #000); color: rgba(255,255,255,.72); }
  .ps-footc-brand { background: var(--ps1); color: rgba(255,255,255,.8); }
  .ps-footc-dark .ps-head, .ps-footc-brand .ps-head { color: #fff; }
  /* The muted text is slate on paper (matching the shipped footer) and light
     on a dark/brand band — the class beats the slate utility by specificity so
     no !important is needed and the paper default is untouched. */
  .ps-footc-dark .ps-foot-muted, .ps-footc-brand .ps-foot-muted { color: rgba(255,255,255,.72); }
  .ps-footc-dark .ps-foot-link:hover, .ps-footc-brand .ps-foot-link:hover { color: #fff; }
  .ps-foot-center { text-align: center; }
  .ps-foot-center .ps-foot-cols { display: grid; grid-template-columns: 1fr; gap: 1.25rem; justify-items: center; }
  .ps-foot-social { display: flex; gap: .5rem; margin-top: .8rem; }
  .ps-foot-center .ps-foot-social { justify-content: center; }
  .ps-foot-social a { display: grid; place-items: center; width: 2rem; height: 2rem;
    border-radius: 999px; border: 1px solid currentColor; opacity: .75; font-size: .7rem;
    font-weight: 700; transition: opacity .2s; }
  .ps-foot-social a:hover { opacity: 1; }

  /* ── Hero background video ── */
  .ps-hero-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

  /* ── Custom-page blocks ── */
  .ps-pgblocks { display: grid; gap: 1.4rem; max-width: 48rem; }
  .ps-pgblock-imgtext { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
    gap: 1.25rem; align-items: center; padding: var(--ps-card-pad); }
  @media (max-width: 640px) { .ps-pgblock-imgtext { grid-template-columns: 1fr; } }

  /* ── Festive overlay ──
     A decoration layer OVER the page (fixed, pointer-events none, under the
     nav's z-50). Positions are constants, not randomness — the server and the
     hydration render must agree. Every animation answers to --motion and is
     silenced by motion-off / reduced-motion at the end of this sheet. */
  .ps-fest-ribbon { position: relative; z-index: 51; text-align: center; font-size: .8rem;
    font-weight: 700; letter-spacing: .02em; padding: .45rem .9rem;
    background: color-mix(in srgb, var(--ps2) 24%, var(--paper)); color: var(--ink); }
  .ps-fx { position: fixed; inset: 0; pointer-events: none; z-index: 49; overflow: hidden; }
  .ps-fx-lightrow { position: absolute; top: 0; left: 0; right: 0; display: flex;
    justify-content: space-around; }
  .ps-fx-bulb { width: 9px; height: 9px; border-radius: 999px; margin-top: 12px;
    animation: ps-fx-twinkle calc(1.9s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  @keyframes ps-fx-twinkle { from { opacity: .45; transform: scale(.85); } to { opacity: 1; transform: scale(1.2); } }
  .ps-fx-diya { position: absolute; bottom: 12px; font-size: 30px;
    animation: ps-fx-glow calc(2.3s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  @keyframes ps-fx-glow { from { filter: drop-shadow(0 0 4px rgba(255,170,60,.5)); }
    to { filter: drop-shadow(0 0 16px rgba(255,170,60,.95)); } }
  .ps-fx-burst { position: absolute; width: 130px; height: 130px; border-radius: 999px; opacity: 0;
    background: repeating-conic-gradient(rgba(255,205,120,.95) 0 3deg, transparent 3deg 22deg);
    -webkit-mask: radial-gradient(circle, transparent 40%, #000 41%, #000 54%, transparent 55%);
    mask: radial-gradient(circle, transparent 40%, #000 41%, #000 54%, transparent 55%);
    animation: ps-fx-boom 3.1s ease-out infinite; }
  @keyframes ps-fx-boom { 0% { transform: scale(.05); opacity: 0; } 12% { opacity: calc(.9 * var(--motion) + .1); }
    48% { transform: scale(1); opacity: 0; } 100% { opacity: 0; } }
  .ps-fx-rangoli { position: absolute; width: 180px; height: 180px; border-radius: 999px; opacity: .4;
    background: repeating-conic-gradient(var(--ps2) 0 12deg, var(--ps1) 12deg 24deg);
    -webkit-mask: radial-gradient(circle, #000 0 28%, transparent 29% 44%, #000 45% 58%, transparent 59%);
    mask: radial-gradient(circle, #000 0 28%, transparent 29% 44%, #000 45% 58%, transparent 59%); }
  .ps-fx-blob { position: absolute; width: 200px; height: 200px; border-radius: 999px;
    filter: blur(34px); opacity: .34;
    animation: ps-fx-blob calc(6.5s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  @keyframes ps-fx-blob { from { transform: scale(.9); } to { transform: scale(1.15); } }
  .ps-fx-fall { position: absolute; top: -4%;
    animation: ps-fx-fall linear infinite; }
  @keyframes ps-fx-fall { to { top: 104%; transform: rotate(320deg); } }
  .ps-fx-lantern { position: absolute; top: -2px; font-size: 28px; transform-origin: top center;
    animation: ps-fx-swing calc(3.2s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  @keyframes ps-fx-swing { from { transform: rotate(calc(-9deg * var(--motion))); }
    to { transform: rotate(calc(9deg * var(--motion))); } }
  .ps-fx-moon { position: absolute; top: 70px; right: 28px; font-size: 34px;
    filter: drop-shadow(0 0 10px rgba(255,255,200,.65)); }
  .ps-fx-star { position: absolute; font-size: 12px;
    animation: ps-fx-twinkle calc(2.1s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  .ps-fx-bunting { position: absolute; top: 0; left: 0; right: 0; display: flex; }
  .ps-fx-flag { flex: 1; height: 20px; clip-path: polygon(0 0, 100% 0, 50% 100%); }
  .ps-fx-kite { position: absolute; font-size: 28px; animation: ps-fx-kite 16s linear infinite; }
  @keyframes ps-fx-kite { 0% { left: -6%; top: 58%; transform: rotate(12deg); }
    50% { top: 22%; transform: rotate(-8deg); } 100% { left: 104%; top: 6%; transform: rotate(14deg); } }
  /* Garland: a toran of glyphs strung along the top edge, each swaying on its
     own phase (marigold rows for Navratri/Onam/Ganesh Chaturthi). */
  .ps-fx-garland { position: absolute; top: 0; left: 0; right: 0; display: flex;
    justify-content: space-around; }
  .ps-fx-gitem { font-size: 19px; font-style: normal; margin-top: 2px; transform-origin: top center;
    animation: ps-fx-swing calc(3s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  /* Rise: the fall field mirrored upward (balloons on Children's Day). */
  .ps-fx-rise { position: absolute; top: 104%;
    animation: ps-fx-rise linear infinite; }
  @keyframes ps-fx-rise { to { top: -8%; transform: rotate(-14deg); } }
  /* Sun: a warm morning sun in the top corner (Sankranti/Pongal). */
  .ps-fx-sun { position: absolute; top: 66px; left: 26px; font-size: 36px;
    animation: ps-fx-glow calc(2.6s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  /* Perch: a large glyph resting in a bottom corner with a gentle bob
     (peacock feathers, wheat sheaves). */
  .ps-fx-perch { position: absolute; bottom: 12px; font-size: 34px;
    animation: ps-fx-bob calc(3.4s / (var(--motion) + .06)) ease-in-out infinite alternate; }
  @keyframes ps-fx-bob { from { transform: translateY(0) rotate(-2deg); }
    to { transform: translateY(calc(-7px * var(--motion))) rotate(2deg); } }
  /* Rakhi: a thread medallion — gold centre, pink-gold tassels radiating from
     a ring — turning very slowly in a page corner (Raksha Bandhan). Colours
     are the festival's own thread tones, not palette vars, so the medallion
     reads as a rakhi even before the takeover retints the page. */
  .ps-fx-rakhi { position: absolute; width: 110px; height: 110px; border-radius: 999px; opacity: .45;
    background:
      radial-gradient(circle, #d4a017 0 20%, transparent 21%),
      repeating-conic-gradient(#f25287 0 8deg, #d4a017 8deg 16deg, transparent 16deg 28deg);
    -webkit-mask: radial-gradient(circle, #000 0 26%, transparent 27% 36%, #000 37% 82%, transparent 83%);
    mask: radial-gradient(circle, #000 0 26%, transparent 27% 36%, #000 37% 82%, transparent 83%);
    animation: ps-fx-spin calc(16s / (var(--motion) + .06)) linear infinite; }
  @keyframes ps-fx-spin { to { transform: rotate(360deg); } }

  /* FULL takeover on a night festival: panels and body text follow the dark
     paper via the same tokens the shape control owns. */
  .ps-fest-dark { --ps-card-bg: color-mix(in srgb, var(--paper) 82%, #fff);
    --ps-card-border: 1px solid color-mix(in srgb, var(--ps2) 26%, transparent);
    --ps-card-shadow: 0 18px 40px -20px rgba(0,0,0,.65);
    color: color-mix(in srgb, var(--ink) 72%, var(--paper)); }
  .ps-fest-dark .text-slate-500, .ps-fest-dark .text-slate-600, .ps-fest-dark .text-slate-400,
  .ps-fest-dark .text-slate-700 { color: color-mix(in srgb, var(--ink) 70%, var(--paper)); }
  .ps-fest-dark .ps-card { background: var(--ps-card-bg); border: var(--ps-card-border); }
  .ps-fest-dark .ps-navc-paper { background: color-mix(in srgb, var(--paper) 92%, transparent); }
  .ps-fest-dark .ps-nav-link, .ps-fest-dark .ps-nav-name { color: var(--ink); }
  .ps-fest-dark .ps-menu-card { background: color-mix(in srgb, var(--paper) 88%, #fff);
    border-color: color-mix(in srgb, var(--ps2) 30%, transparent); }
  .ps-fest-dark .ps-menu-card::before { background: color-mix(in srgb, var(--paper) 88%, #fff); }
  .ps-fest-dark .ps-menu-row-label { color: var(--ink); }
  .ps-fest-dark footer { border-color: color-mix(in srgb, var(--ps2) 25%, transparent); }

  /* ── Studio additions: motion kill-switches ──
     Same contract as everything above them: reduced-motion and Animation=Off
     collapse to the END state, never to an invisible half-state. */
  @media (prefers-reduced-motion: reduce) {
    .ps-root .ps-sg-rise .reveal, .ps-root .ps-sg-fade .reveal, .ps-root .ps-sg-draw .reveal,
    .ps-root .ps-sg-slide .reveal, .ps-root .ps-sg-zoom .reveal,
    .ps-root .ps-sg-curtain .reveal, .ps-root .ps-sg-flip .reveal {
      opacity: 1; transform: none; clip-path: none; transition: none; }
    /* Two-class specificity so these beat the .ps-menuanim-* longhands that
       come later in the sheet — the shipped single-class rule did not. */
    .ps-menuanim-slide .ps-menu-card, .ps-menuanim-scale .ps-menu-card { animation: none; }
    .ps-fx-bulb, .ps-fx-diya, .ps-fx-burst, .ps-fx-blob, .ps-fx-fall, .ps-fx-lantern,
    .ps-fx-star, .ps-fx-kite, .ps-fx-gitem, .ps-fx-rise, .ps-fx-sun, .ps-fx-perch,
    .ps-fx-rakhi { animation: none; }
    .ps-fx-burst { opacity: 0; }
    .ps-fx-fall { top: 104%; }
    .ps-fx-rise { top: -8%; }
    .ps-hero-video { display: none; }
    /* Bar fill collapses to its final width, not an empty track. */
    .ps-bar-fill { transition: none; width: var(--ps-bar-w, 75%); }
  }
  .ps-motion-off .ps-sg-rise .reveal, .ps-motion-off .ps-sg-fade .reveal,
  .ps-motion-off .ps-sg-draw .reveal, .ps-motion-off .ps-sg-slide .reveal,
  .ps-motion-off .ps-sg-zoom .reveal, .ps-motion-off .ps-sg-curtain .reveal,
  .ps-motion-off .ps-sg-flip .reveal { opacity: 1; transform: none; clip-path: none; transition: none; }
  /* Menu open animations: the shipped '.ps-motion-off .ps-menu-card' is beaten
     by the later equal-specificity .ps-menuanim-* longhands, so silence them
     with a three-class selector that wins. */
  .ps-motion-off.ps-menuanim-slide .ps-menu-card, .ps-motion-off.ps-menuanim-scale .ps-menu-card,
  .ps-motion-off .ps-menuanim-slide .ps-menu-card, .ps-motion-off .ps-menuanim-scale .ps-menu-card {
    animation: none; }
  .ps-motion-off .ps-fx-bulb, .ps-motion-off .ps-fx-diya, .ps-motion-off .ps-fx-burst,
  .ps-motion-off .ps-fx-blob, .ps-motion-off .ps-fx-fall, .ps-motion-off .ps-fx-lantern,
  .ps-motion-off .ps-fx-star, .ps-motion-off .ps-fx-kite { animation: none; }
  .ps-motion-off .ps-fx-burst { opacity: 0; }
  .ps-motion-off .ps-fx-fall { top: 104%; }
  .ps-motion-off .ps-hero-video { display: none; }
  /* ═══════════════ END WEBSITE STUDIO ADDITIONS ═══════════════ */

  /* Animation level = Off — same statics as reduced-motion, admin-driven. */
  .ps-motion-off .ps-marker { animation: none; background-size: 100% .38em; }
  .ps-motion-off .ps-accent-grow { animation: none; transform: scaleX(1); }
  .ps-motion-off .ps-underline path { animation: none; stroke-dashoffset: 0; }
  .ps-motion-off .ps-kb { animation: none; }
  .ps-motion-off .ps-menu { animation: none; }
  .ps-motion-off .ps-jline-mask, .ps-motion-off .ps-jbadge, .ps-motion-off .ps-jbody,
  .ps-motion-off .ps-rail-fill, .ps-motion-off .ps-rstep { transition: none; }
  .ps-motion-off .ps-jline-mask { width: 100%; }
  .ps-motion-off .ps-jbadge { transform: scale(1); }
  .ps-motion-off .ps-jbody, .ps-motion-off .ps-rstep { opacity: 1; transform: none; }
  .ps-motion-off .ps-rail-fill { height: calc(100% - 16px); }
  .ps-motion-off .ps-bar-fill { transition: none; width: var(--ps-bar-w, 75%); }
`;
