import { Inter, Fraunces, Poppins, Nunito } from 'next/font/google';

/**
 * The four display families a school can pick for its public site.
 *
 * These used to be fetched at runtime from fonts.googleapis.com via a <link>
 * rendered inside PublicSite — a render-blocking request to a third-party
 * origin on every school page, after the HTML had already started painting.
 * next/font self-hosts them, emits the preload links in <head>, and inlines
 * the @font-face rules, so there is no extra connection and no FOUT window.
 *
 * All four load on every school page because the choice is per-tenant data,
 * not known at build time. They are subset to latin and limited to the weights
 * the theme actually uses.
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

/** Put this on a wrapper element to make all four CSS variables available below it. */
export const fontVars = `${inter.variable} ${fraunces.variable} ${poppins.variable} ${nunito.variable}`;

// Re-exported from its own pure module so unit-testable code can read the
// mapping without importing this file's next/font side effects.
export { FONT_STACK } from './font-stack';
