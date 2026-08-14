import { BookOpen } from 'lucide-react';

/**
 * The librarian portal's nav.
 *
 * Its own module, never a named export from `layout.tsx`: the App Router
 * validates a layout's exports against a fixed allowlist at `next build` time
 * only, so a stray `export const NAV_ITEMS` passes tsc, lint and vitest and
 * fails on Vercel. That broke the build twice (staff, teacher) and
 * `app/route-file-exports.test.ts` now reproduces the gate locally.
 *
 * ONE entry, and that is the design rather than a first cut. The counter is a
 * single scrolling screen ordered by how often a librarian does each thing —
 * take a book back, give one out, find a number, see what is late. A tab bar
 * would put her most frequent action one click away from itself, and a
 * permanent "Fines" tab in a product where fines are off by default is an
 * empty room she walks into forever (the student screen carries the same
 * reasoning in its own header).
 */
export const NAV_ITEMS = [{ href: '/library', label: 'Counter', icon: BookOpen }];
