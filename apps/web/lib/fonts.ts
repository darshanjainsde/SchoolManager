import {
  Inter,
  Fraunces,
  Poppins,
  Nunito,
  Playfair_Display,
  Space_Grotesk,
  Montserrat,
  Lora,
} from 'next/font/google';

/**
 * The display families a school can pick for its public site.
 *
 * These used to be fetched at runtime from fonts.googleapis.com via a <link>
 * rendered inside PublicSite — a render-blocking request to a third-party
 * origin on every school page, after the HTML had already started painting.
 * next/font self-hosts them, emits the preload links in <head>, and inlines
 * the @font-face rules, so there is no extra connection and no FOUT window.
 *
 * The choice is per-tenant data, not known at build time, so every family's
 * @font-face rule ships on every page. But only the ORIGINAL four preload:
 * the added families set `preload: false`, so their @font-face sits inert in
 * the CSS and the browser downloads a family only when a school actually
 * selects it (font files are fetched lazily on first use). That keeps a page
 * that never uses them from paying for them. All are subset to latin and
 * limited to the weights the theme uses.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--f-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--f-fraunces',
  display: 'swap',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--f-poppins',
  display: 'swap',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--f-nunito',
  display: 'swap',
});

// ── Added families (loaded on demand — preload:false) ──
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--f-playfair',
  display: 'swap',
  preload: false,
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--f-space-grotesk',
  display: 'swap',
  preload: false,
});

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--f-montserrat',
  display: 'swap',
  preload: false,
});

const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
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
