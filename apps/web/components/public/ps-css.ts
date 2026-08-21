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
  .ps-root { font-family: 'Inter', sans-serif; background: var(--paper); color: #43514a; overflow-x: hidden; min-height: 100vh; }
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
     itself — the same gesture at section scale, not a second idea. */
  .ps-gesture-draw .reveal { opacity: 1; transform: none;
    clip-path: inset(0 100% 0 0);
    transition: clip-path .85s cubic-bezier(.2,.7,.2,1); }
  .ps-gesture-draw .reveal.in { clip-path: inset(0 0 0 0); }
  .ps-motion-off .ps-gesture-draw .reveal, .ps-gesture-draw.ps-motion-off .reveal {
    clip-path: none; transition: none; }
  /* SLIDE: sections enter from the side (distance scales with the volume knob). */
  .ps-gesture-slide .reveal { transform: translateX(calc(-44px * var(--motion) - 6px)); }
  .ps-gesture-slide .reveal.in { transform: none; }
  /* ZOOM: sections scale up into place. */
  .ps-gesture-zoom .reveal { transform: scale(calc(1 - 0.12 * var(--motion))); }
  .ps-gesture-zoom .reveal.in { transform: none; }
  /* CURTAIN: uncovers top to bottom. */
  .ps-gesture-curtain .reveal { opacity: 1; transform: none;
    clip-path: inset(0 0 100% 0);
    transition: clip-path .8s cubic-bezier(.4,0,.1,1); }
  .ps-gesture-curtain .reveal.in { clip-path: inset(0 0 0 0); }
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
  /* Ground is a NEUTRAL darkening of the paper (not the brand ink, which cast a
     greenish tint), and the shadow is soft, even and neutral so the rounded
     corners don't show an uneven shade. */
  .ps-shape-panels { background: color-mix(in srgb, #10131a 4.5%, var(--paper)); }
  .ps-shape-panels > section,
  .ps-shape-panels > div[data-sec]:not([data-sec="hero"]) {
    background: var(--paper);
    border-radius: 22px;
    margin: 16px clamp(10px, 2vw, 20px) 0;
    box-shadow: 0 8px 26px -20px rgba(17,20,28,.25);
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
    position: sticky; top: 0; background: var(--paper);
    box-shadow: 0 -18px 44px rgba(15,23,20,.14); }
  .ps-scroll-deck > #ps-nav, .ps-scroll-deck > header { position: sticky; }
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
        from { clip-path: inset(0 100% 0 0); }
        to   { clip-path: inset(0 0 0 0); }
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
    clip-path: inset(0 100% 0 0);
    transition: clip-path .85s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-draw .reveal.in { clip-path: inset(0 0 0 0); }
  .ps-root .ps-sg-slide .reveal { opacity: 0; clip-path: none;
    transform: translateX(calc(-44px * var(--motion) - 6px));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-slide .reveal.in { opacity: 1; transform: none; }
  .ps-root .ps-sg-zoom .reveal { opacity: 0; clip-path: none;
    transform: scale(calc(1 - 0.12 * var(--motion)));
    transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .ps-root .ps-sg-zoom .reveal.in { opacity: 1; transform: none; }
  .ps-root .ps-sg-curtain .reveal { opacity: 1; transform: none;
    clip-path: inset(0 0 100% 0);
    transition: clip-path .8s cubic-bezier(.4,0,.1,1); }
  .ps-root .ps-sg-curtain .reveal.in { clip-path: inset(0 0 0 0); }
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
  .ps-v-about-center.ps-about-grid { grid-template-columns: 1fr !important;
    text-align: center; max-width: 46rem; margin-inline: auto; }
  .ps-v-about-center .ps-about-img-wrap { order: 2; max-width: 34rem; margin-inline: auto; width: 100%; }
  .ps-v-about-center .ps-about-copy blockquote { border-left: 0; padding-left: 0; }

  /* ── Courses variants ── */
  .ps-v-courses-carousel .ps-courses-grid { display: flex; overflow-x: auto; gap: 1.25rem;
    scroll-snap-type: x mandatory; padding-bottom: .75rem;
    -webkit-overflow-scrolling: touch; }
  .ps-v-courses-carousel .ps-courses-grid > .reveal { flex: 0 0 min(78%, 320px); scroll-snap-align: start; }
  .ps-v-courses-rows .ps-courses-grid { grid-template-columns: minmax(0, 1fr) !important;
    max-width: 42rem; margin-inline: auto; }

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

  /* ── Staff LIST variant ── */
  .ps-v-staff-list .ps-staff-grid { grid-template-columns: minmax(0, 1fr) !important;
    max-width: 40rem; margin-inline: auto; gap: .75rem; }
  .ps-v-staff-list .ps-staffcard { display: flex; align-items: center; gap: 1rem;
    text-align: left; padding: .9rem 1.1rem; }
  .ps-v-staff-list .ps-staffcard > div:first-child { margin: 0; height: 3.2rem; width: 3.2rem;
    font-size: 1.1rem; flex: none; }
  .ps-v-staff-list .ps-staffcard .ps-head { margin-top: 0; }

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
    .ps-fx-star, .ps-fx-kite { animation: none; }
    .ps-fx-burst { opacity: 0; }
    .ps-fx-fall { top: 104%; }
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
