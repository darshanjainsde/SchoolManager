import localFont from 'next/font/local';

/**
 * The display families a school can pick for its public site — SELF-HOSTED.
 *
 * WHY THE FILES ARE IN THE REPO. These were `next/font/google`, which fetches
 * every family's CSS and woff2 from fonts.googleapis.com **at build time**.
 * That makes Google's availability a dependency of every deploy: when one of
 * those requests hiccups, the loader's regex finds nothing, and the whole
 * build dies with `An error occurred in next/font — Cannot read properties of
 * null (reading '1')`. It happened twice in one afternoon: once locally, and
 * once on the staging deploy of PR #122. Nothing in the repo had changed.
 *
 * `next/font/local` reads the same woff2 files off disk, emits the same
 * @font-face rules and the same CSS variables, and preloads nothing it is not
 * told to — so the output is unchanged and the network is out of the build.
 * `assets/fonts/*.woff2` are the LATIN subsets Google itself serves (see
 * scripts/fetch-fonts.mjs for the exact fetch), 25 files, ~836 KB in the repo
 * and nothing extra on the wire.
 *
 * The choice is per-tenant data, not known at build time, so every family's
 * @font-face rule ships on every page. Only Inter preloads, because it is the
 * one family EVERY page uses — the consoles, the login screens and the
 * fallback stack. Every display family sets `preload: false`, so its
 * @font-face sits inert in the CSS and the browser downloads it only when a
 * school actually selects it. `display: 'swap'` means a school on Poppins
 * still paints its text immediately in the fallback and swaps when the file
 * lands, so nothing is hidden waiting on a font.
 */

const inter = localFont({
  src: [
    { path: '../assets/fonts/inter-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/inter-500.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/inter-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/inter-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-inter',
  display: 'swap',
});

const fraunces = localFont({
  src: [
    { path: '../assets/fonts/fraunces-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/fraunces-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-fraunces',
  display: 'swap',
  preload: false,
});

const poppins = localFont({
  src: [
    { path: '../assets/fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/poppins-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/poppins-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-poppins',
  display: 'swap',
  preload: false,
});

const nunito = localFont({
  src: [
    { path: '../assets/fonts/nunito-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/nunito-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/nunito-700.woff2', weight: '700', style: 'normal' },
    { path: '../assets/fonts/nunito-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--f-nunito',
  display: 'swap',
  preload: false,
});

const playfair = localFont({
  src: [
    { path: '../assets/fonts/playfair-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/playfair-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-playfair',
  display: 'swap',
  preload: false,
});

const spaceGrotesk = localFont({
  src: [
    { path: '../assets/fonts/space-grotesk-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/space-grotesk-500.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/space-grotesk-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-space-grotesk',
  display: 'swap',
  preload: false,
});

const montserrat = localFont({
  src: [
    { path: '../assets/fonts/montserrat-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/montserrat-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/montserrat-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-montserrat',
  display: 'swap',
  preload: false,
});

const lora = localFont({
  src: [
    { path: '../assets/fonts/lora-400.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/lora-600.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/lora-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--f-lora',
  display: 'swap',
  preload: false,
});

/** Put this on a wrapper element to make every family's CSS variable available below it. */
export const fontVars = [
  inter.variable,
  fraunces.variable,
  poppins.variable,
  nunito.variable,
  playfair.variable,
  spaceGrotesk.variable,
  montserrat.variable,
  lora.variable,
].join(' ');

// Re-exported from its own pure module so unit-testable code can read the
// mapping without importing this file's next/font side effects.
export { FONT_STACK } from './font-stack';
